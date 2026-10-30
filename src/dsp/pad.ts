import { Envelope, midiToHz, Stage } from './fm';
import type { PolyVoice } from './poly';
import { Svf } from './svf';

/**
 * Pad voice: three detuned oscillators (saw to square), an octave-down sine,
 * slow drift, and a resonant low-pass with its own slow envelope. Lush when
 * slow, glassy with Shape up and the filter closed.
 */
export interface PadParams {
  /** 0 is saw, 1 is square, in between blends them. */
  shape: number;
  /** Spread of the outer two oscillators, in cents. */
  detune: number;
  sub: number;
  /** Slow random pitch wander, in cents. */
  drift: number;
  cutoff: number;
  resonance: number;
  /** Octaves the filter envelope opens the cutoff by. */
  filterEnv: number;
  filterAttack: number;
  filterDecay: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  level: number;
}

export function defaultPadParams(): PadParams {
  return {
    shape: 0.2,
    detune: 14,
    sub: 0.3,
    drift: 6,
    cutoff: 900,
    resonance: 1.2,
    filterEnv: 1.5,
    filterAttack: 1.2,
    filterDecay: 2.5,
    attack: 0.9,
    decay: 1.5,
    sustain: 0.8,
    release: 2.5,
    level: 0.7,
  };
}

/** PolyBLEP: rounds off a discontinuity so saws and squares don't alias badly. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

const DETUNE = [-1, 0, 1];

export class PadVoice implements PolyVoice<PadParams> {
  note = 60;
  startedAt = 0;
  releaseAt = Infinity;
  private params: PadParams | null = null;
  private velocity = 0;
  private amp = new Envelope();
  private fenv = new Envelope();
  private phases = [0, 0, 0];
  private sub = 0;
  private drift = 0;
  private driftTarget = 0;
  private driftCount = 0;
  private lp = new Svf();

  constructor(private readonly random: () => number = Math.random) {}

  get active(): boolean {
    return this.amp.stage !== Stage.Idle;
  }

  start(note: number, velocity: number, frame: number, releaseAt: number, params: PadParams | null): void {
    const fresh = !this.active;
    this.note = note;
    this.velocity = velocity;
    this.startedAt = frame;
    this.releaseAt = releaseAt;
    this.params = params;
    if (fresh) {
      // Free-running phases, so a chord's notes never line up into one buzz.
      this.phases = this.phases.map(() => this.random());
      this.lp.reset();
    }
    this.amp.trigger();
    this.fenv.trigger();
  }

  release(): void {
    this.releaseAt = Infinity;
    this.amp.release();
    this.fenv.release();
  }

  render(live: PadParams, sr: number): number {
    const p = this.params ?? live;
    if (--this.driftCount <= 0) {
      this.driftTarget = (this.random() * 2 - 1) * p.drift;
      this.driftCount = Math.round(sr * 0.25);
    }
    this.drift += (this.driftTarget - this.drift) * (4 / sr);
    const hz = midiToHz(this.note) * Math.pow(2, this.drift / 1200);
    let osc = 0;
    for (let i = 0; i < 3; i++) {
      const f = hz * Math.pow(2, (DETUNE[i] * p.detune) / 1200);
      const dt = f / sr;
      const t = this.phases[i];
      const saw = 2 * t - 1 - blep(t, dt);
      const t2 = (t + 0.5) % 1;
      const square = (t < 0.5 ? 1 : -1) + blep(t, dt) - blep(t2, dt);
      osc += saw + (square - saw) * p.shape;
      this.phases[i] = (t + dt) % 1;
    }
    this.sub = (this.sub + hz / 2 / sr) % 1;
    const x = osc / 3 + Math.sin(this.sub * Math.PI * 2) * p.sub;
    const amp = this.amp.next(p, sr);
    const fe = this.fenv.next({ attack: p.filterAttack, decay: p.filterDecay, sustain: 0.3, release: p.release }, sr);
    this.lp.run(x, p.cutoff * Math.pow(2, p.filterEnv * fe), p.resonance, sr);
    return this.lp.low * amp * this.velocity * 0.9;
  }
}
