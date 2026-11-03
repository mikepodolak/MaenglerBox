import { midiToHz } from './fm';
import type { PolyVoice } from './poly';

/**
 * Modal percussion: a strike excites a bank of tuned resonators, one per
 * vibration mode of an object (a skin, a bar, a plate, a bell...). Smaller,
 * stiffer objects have higher, more stretched modes; harder materials let
 * the high modes ring longer.
 */
export interface ModalParams {
  /** Index into BODIES. */
  body: number;
  /** Seconds for the fundamental to fade by 60 dB. */
  decay: number;
  /** 0 is soft (high modes die fast, like wood), 1 is hard (metal, glass). */
  material: number;
  /** −1 squeezes the modes together, +1 spreads them apart. */
  stretch: number;
  /** Where it's struck, 0 edge .. 1 centre. The centre cancels odd-shaped modes. */
  position: number;
  /** Semitones the pitch falls from at the strike, like a tom's pitch drop. */
  bend: number;
  /** Seconds the bend takes. */
  bendTime: number;
  /** Index into EXCITERS. */
  exciter: number;
  /** 0 is a soft mallet, 1 a hard stick (shorter contact, brighter). */
  hardness: number;
  /** Noise mixed into the strike. */
  noise: number;
  /** Seconds to die away once the note ends; long keeps it ringing. */
  damp: number;
  level: number;
}

export function defaultModalParams(): ModalParams {
  return { body: 0, decay: 0.6, material: 0.4, stretch: 0, position: 0.3, bend: 3, bendTime: 0.08, exciter: 0, hardness: 0.6, noise: 0.05, damp: 4, level: 0.8 };
}

/** Mode frequency ratios for each body. Our own approximations of the physics. */
export const BODIES: { name: string; ratios: number[] }[] = [
  { name: 'Skin', ratios: [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.6, 4.06] },
  { name: 'Tom', ratios: [1, 1.5, 1.98, 2.44, 2.9, 3.33, 3.8, 4.2] },
  { name: 'Bar', ratios: [1, 2.76, 5.4, 8.93, 13.34, 18.64] },
  { name: 'Plate', ratios: [1, 1.62, 2.06, 2.53, 2.94, 3.23, 3.73, 4.16, 4.6, 5.1] },
  { name: 'Bell', ratios: [0.5, 1, 1.19, 1.5, 2, 2.5, 2.66, 3, 4, 5.34] },
  { name: 'Chime', ratios: [1, 2.32, 4.25, 6.63, 9.38, 12.5] },
  { name: 'Box', ratios: [1, 1.48, 2.24, 3.09, 3.87, 4.55, 5.6] },
  { name: 'Glass', ratios: [1, 2.31, 3.98, 5.92, 8.07, 10.4] },
  { name: 'Tine', ratios: [1, 2, 3, 4, 5, 6, 7, 8] },
];

export const EXCITERS = ['Tap', 'Mallet', 'Noise', 'Brush'];

export const MAX_MODES = 10;
const SILENT = 1e-5;
/** Resonator coefficients are refreshed this often (samples) while the pitch bends. */
const COEF_EVERY = 32;

/** Mode ratios after Stretch, which bends them apart (or together) more the higher they are. */
export function stretchedRatios(body: number, stretch: number): number[] {
  const b = BODIES[Math.max(0, Math.min(BODIES.length - 1, Math.round(body)))];
  return b.ratios.map((r) => Math.pow(r, 1 + stretch * 0.35));
}

/** How loud each mode is for a strike at `position`, falling off with mode number. */
export function modeGains(n: number, position: number): number[] {
  const x = 0.07 + 0.43 * Math.max(0, Math.min(1, position));
  return Array.from({ length: n }, (_, k) => (0.25 + 0.75 * Math.abs(Math.sin(Math.PI * (k + 1) * x))) / Math.sqrt(k + 1));
}

/** Seconds for mode k (at ratio r) to fade: high modes fade faster on soft materials. */
export function modeDecay(decay: number, ratio: number, material: number): number {
  const loss = (1 - material) * 3 + 0.05;
  return Math.max(0.004, decay / (1 + loss * Math.max(0, ratio - 1)));
}

export class ModalVoice implements PolyVoice<ModalParams> {
  note = 60;
  startedAt = 0;
  releaseAt = Infinity;
  private params: ModalParams | null = null;
  private velocity = 0;
  private y1 = new Float64Array(MAX_MODES);
  private y2 = new Float64Array(MAX_MODES);
  private c1 = new Float64Array(MAX_MODES);
  private c2 = new Float64Array(MAX_MODES);
  private b0 = new Float64Array(MAX_MODES);
  private gain = new Float64Array(MAX_MODES);
  private ratios: number[] = [];
  private modes = 0;
  private age = 0;
  private exciteLen = 1;
  private lp = 0;
  private released = false;
  private releaseGain = 1;
  private peak = 0;
  private sincePeak = 0;
  private alive = false;

  constructor(private readonly random: () => number = Math.random) {}

  get active(): boolean {
    return this.alive;
  }

  start(note: number, velocity: number, frame: number, releaseAt: number, params: ModalParams | null): void {
    this.note = note;
    this.velocity = velocity;
    this.startedAt = frame;
    this.releaseAt = releaseAt;
    this.params = params;
    this.age = 0;
    this.lp = 0;
    this.released = false;
    this.releaseGain = 1;
    this.peak = 0;
    this.sincePeak = 0;
    this.alive = true;
    this.coefs = null;
  }

  release(): void {
    this.releaseAt = Infinity;
    this.released = true;
  }

  private coefs: ModalParams | null = null;

  /** Recompute the resonators for the current pitch (it falls during a bend). */
  private tune(p: ModalParams, sr: number): void {
    if (this.coefs !== p || this.age === 0) {
      this.ratios = stretchedRatios(p.body, p.stretch).slice(0, MAX_MODES);
      this.modes = this.ratios.length;
      const g = modeGains(this.modes, p.position);
      for (let k = 0; k < this.modes; k++) this.gain[k] = g[k];
      this.coefs = p;
    }
    const t = this.age / sr;
    const bend = p.bend * Math.exp(-t / Math.max(0.005, p.bendTime));
    const hz = midiToHz(this.note) * Math.pow(2, bend / 12);
    for (let k = 0; k < this.modes; k++) {
      const f = hz * this.ratios[k];
      if (f >= sr * 0.45) {
        this.c1[k] = 0;
        this.c2[k] = 0;
        this.b0[k] = 0;
        continue;
      }
      const r = Math.pow(0.001, 1 / (modeDecay(p.decay, this.ratios[k], p.material) * sr));
      this.c1[k] = 2 * r * Math.cos((2 * Math.PI * f) / sr);
      this.c2[k] = -r * r;
      // Scaling the input by sin(w) gives every mode the same ring for the same strike.
      this.b0[k] = Math.sin((2 * Math.PI * f) / sr);
    }
  }

  /** The strike: a short burst whose length and colour come from Exciter and Hardness. */
  private excite(p: ModalParams, sr: number): number {
    const kind = Math.round(p.exciter);
    const contact = (0.0003 + (1 - p.hardness) * 0.004) * sr;
    const len = kind === 3 ? 0.06 * sr : kind === 2 ? 0.012 * sr : kind === 1 ? contact * 2.5 : contact;
    this.exciteLen = len;
    if (this.age >= len) return 0;
    const ph = this.age / len;
    const n = this.random() * 2 - 1;
    let x: number;
    if (kind === 0) x = ph < 0.5 ? 1 : -0.3;
    else if (kind === 1) x = 1.25 - 1.25 * Math.cos(2 * Math.PI * ph);
    else if (kind === 2) x = n * (1 - ph);
    else x = n * Math.exp(-ph * 3) * 2;
    x += n * p.noise * (1 - ph);
    // Softer strikes are darker.
    this.lp += (x - this.lp) * (0.1 + 0.9 * p.hardness);
    // Longer strikes put in more energy; even them out so every exciter is about as loud.
    // Pulses add up with their length, noise only with its square root.
    return this.lp * (kind >= 2 ? Math.sqrt(20 / Math.max(20, len)) : 20 / Math.max(20, len));
  }

  render(live: ModalParams, sr: number): number {
    if (!this.alive) return 0;
    const p = this.params ?? live;
    if (this.age % COEF_EVERY === 0) this.tune(p, sr);
    const x = this.excite(p, sr) * this.velocity;
    let y = 0;
    for (let k = 0; k < this.modes; k++) {
      const v = x * this.gain[k] * this.b0[k] + this.c1[k] * this.y1[k] + this.c2[k] * this.y2[k];
      this.y2[k] = this.y1[k];
      this.y1[k] = v;
      y += v;
    }
    if (this.released) this.releaseGain *= Math.pow(0.001, 1 / (Math.max(0.005, p.damp) * sr));
    this.age++;
    const out = y * this.releaseGain * 0.08;
    // Stop once it has been quiet for 50 ms after the strike.
    const a = Math.abs(out);
    if (a > this.peak) this.peak = a;
    if (++this.sincePeak > sr * 0.05) {
      if (this.peak < SILENT && this.age > this.exciteLen) {
        this.alive = false;
        this.y1.fill(0);
        this.y2.fill(0);
      }
      this.peak = 0;
      this.sincePeak = 0;
    }
    return out;
  }
}
