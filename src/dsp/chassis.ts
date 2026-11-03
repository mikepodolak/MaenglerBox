/**
 * Sample-level cores for the Chassis-inspired utilities: an envelope
 * follower, two-input CV math, and a frequency shifter. No Web Audio here,
 * so they're unit-tested in Node.
 */

// --- Follower ----------------------------------------------------------------

export interface FollowerSettings {
  /** Seconds to rise. */
  attack: number;
  /** Seconds to fall. */
  release: number;
  /** Multiplies the level before it comes out. */
  gain: number;
  /** Level (after gain) above which the gate opens. */
  threshold: number;
}

/** A crossing of the threshold, for the module's gate out. */
export interface FollowerEdge {
  frame: number;
  rising: boolean;
}

/** Follows how loud a signal is: rectify, then rise and fall at their own speeds. */
export class FollowerCore {
  settings: FollowerSettings = { attack: 0.005, release: 0.15, gain: 2, threshold: 0.3 };
  level = 0;
  open = false;

  process(input: Float32Array | undefined, out: Float32Array, start: number, sr: number, edges?: FollowerEdge[]): void {
    const s = this.settings;
    const up = 1 - Math.exp(-1 / (Math.max(0.0005, s.attack) * sr));
    const down = 1 - Math.exp(-1 / (Math.max(0.001, s.release) * sr));
    for (let i = 0; i < out.length; i++) {
      const x = Math.abs(input?.[i] ?? 0);
      this.level += (x - this.level) * (x > this.level ? up : down);
      const v = Math.min(4, this.level * s.gain);
      out[i] = v;
      // A little hysteresis so a level sitting on the threshold doesn't chatter.
      if (!this.open && v > s.threshold) {
        this.open = true;
        edges?.push({ frame: start + i, rising: true });
      } else if (this.open && v < s.threshold * 0.8) {
        this.open = false;
        edges?.push({ frame: start + i, rising: false });
      }
    }
  }
}

// --- Math --------------------------------------------------------------------

export const MATH_OPS = ['A + B', 'A − B', 'A × B', 'Min', 'Max', 'A > B', '|A|', 'Fold A', 'Slew A', 'Steps A'];

export interface MathSettings {
  op: number;
  /** Attenuverters on each input, −2..2. */
  gainA: number;
  gainB: number;
  /** Added after the operator. */
  offset: number;
  /** Seconds for Slew A to travel the full range; also the fold amount and step count's partner. */
  amount: number;
}

/** One sample of the operator, before offset. */
export function mathOp(op: number, a: number, b: number, amount: number): number {
  switch (Math.round(op)) {
    case 0:
      return a + b;
    case 1:
      return a - b;
    case 2:
      return a * b;
    case 3:
      return Math.min(a, b);
    case 4:
      return Math.max(a, b);
    case 5:
      return a > b ? 1 : 0;
    case 6:
      return Math.abs(a);
    case 7:
      return fold(a * (1 + amount * 7));
    case 9: {
      const steps = 2 + Math.round(amount * 14);
      return Math.round(a * steps) / steps;
    }
    default:
      return a;
  }
}

/** Triangle wavefolding into −1..1. */
export function fold(x: number): number {
  const t = (((x + 1) % 4) + 4) % 4;
  return t < 2 ? t - 1 : 3 - t;
}

export class MathCore {
  settings: MathSettings = { op: 0, gainA: 1, gainB: 1, offset: 0, amount: 0.2 };
  private slewed = 0;

  process(a: Float32Array | undefined, b: Float32Array | undefined, out: Float32Array, sr: number): void {
    const s = this.settings;
    const slew = Math.round(s.op) === 8;
    const maxStep = slew ? 2 / Math.max(1, s.amount * 2 * sr) : 0;
    for (let i = 0; i < out.length; i++) {
      const x = (a?.[i] ?? 0) * s.gainA;
      const y = (b?.[i] ?? 0) * s.gainB;
      let v: number;
      if (slew) {
        this.slewed += Math.max(-maxStep, Math.min(maxStep, x - this.slewed));
        v = this.slewed;
      } else v = mathOp(s.op, x, y, s.amount);
      out[i] = v + s.offset;
    }
  }
}

// --- Frequency shifter --------------------------------------------------------

/**
 * Two chains of allpass sections whose outputs stay about 90° apart across
 * most of the audio band (a Hilbert transformer). Coefficients are the
 * widely published 8-section design for this.
 */
const HILBERT_A = [0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737].map((c) => c * c);
const HILBERT_B = [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278].map((c) => c * c);

class AllpassChain {
  private x1: number[];
  private x2: number[];
  private y1: number[];
  private y2: number[];

  constructor(private readonly c: number[]) {
    this.x1 = c.map(() => 0);
    this.x2 = c.map(() => 0);
    this.y1 = c.map(() => 0);
    this.y2 = c.map(() => 0);
  }

  run(x: number): number {
    let v = x;
    for (let k = 0; k < this.c.length; k++) {
      const y = this.c[k] * (v + this.y2[k]) - this.x2[k];
      this.x2[k] = this.x1[k];
      this.x1[k] = v;
      this.y2[k] = this.y1[k];
      this.y1[k] = y;
      v = y;
    }
    return v;
  }
}

export const SHIFT_SIDES = ['Up', 'Down', 'Both'];

export interface ShifterSettings {
  /** Hz every partial moves by (negative swaps up and down). */
  shift: number;
  side: number;
  feedback: number;
  mix: number;
}

/** Moves every frequency by the same number of hertz, so harmonic sounds turn clangorous. */
export class ShifterCore {
  settings: ShifterSettings = { shift: 40, side: 0, feedback: 0, mix: 1 };
  private a = new AllpassChain(HILBERT_A);
  private b = new AllpassChain(HILBERT_B);
  private bDelay = 0;
  private phase = 0;
  private last = 0;

  process(input: Float32Array | undefined, out: Float32Array, sr: number): void {
    const s = this.settings;
    const dp = s.shift / sr;
    const side = Math.round(s.side);
    const fb = Math.max(0, Math.min(0.95, s.feedback));
    for (let i = 0; i < out.length; i++) {
      const dry = input?.[i] ?? 0;
      const x = dry + Math.tanh(this.last * fb * 1.2);
      const re = this.a.run(x);
      const imNow = this.b.run(x);
      const im = this.bDelay;
      this.bDelay = imNow;
      const w = this.phase * 2 * Math.PI;
      const c = Math.cos(w);
      const sn = Math.sin(w);
      // With these chains the B path lags A by 90°, so adding the products moves frequencies up.
      const up = re * c + im * sn;
      const down = re * c - im * sn;
      const wet = side === 0 ? up : side === 1 ? down : (up + down) * 0.5;
      this.last = wet;
      this.phase = (this.phase + dp) % 1;
      if (this.phase < 0) this.phase += 1;
      out[i] = dry * (1 - s.mix) + wet * s.mix;
    }
  }
}
