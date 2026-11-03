import { Envelope, midiToHz, Stage } from './fm';
import { blep } from './pad';
import type { PolyVoice } from './poly';
import { Svf } from './svf';

/**
 * Supersaw: a stack of band-limited saws per note, spread in pitch, with a
 * centre-vs-sides blend, an octave-down sub, slow drift, and a low-pass.
 */
export interface SupersawParams {
  /** Saws per note, 1..9. */
  voices: number;
  /** 0..1; the outer saws reach about ±60 cents at 1 (curved, so small values are fine-grained). */
  detune: number;
  /** 0 is the centre saw only, 1 is the outer saws only, 0.5 is even. */
  blend: number;
  sub: number;
  /** Slow random pitch wander per saw, in cents. */
  drift: number;
  cutoff: number;
  resonance: number;
  filterEnv: number;
  filterDecay: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  level: number;
}

export function defaultSupersawParams(): SupersawParams {
  return { voices: 7, detune: 0.35, blend: 0.6, sub: 0.2, drift: 3, cutoff: 3500, resonance: 0.9, filterEnv: 1, filterDecay: 0.6, attack: 0.01, decay: 0.8, sustain: 0.7, release: 0.6, level: 0.7 };
}

export const MAX_SAWS = 9;
const MAX_CENTS = 60;

/** Spread of saw i of n in −1..1, centre saw at 0 when n is odd. */
export function sawSpread(i: number, n: number): number {
  return n <= 1 ? 0 : (i / (n - 1)) * 2 - 1;
}

/**
 * Gains for centre and outer saws, scaled so the stack's level stays about
 * the same whatever the voice count (normalised by root-sum-of-squares).
 */
export function sawGains(n: number, blend: number): number[] {
  const g = Array.from({ length: n }, (_, i) => (n > 1 && Math.abs(sawSpread(i, n)) < 1e-6 ? 1 - blend : n === 1 ? 1 : blend));
  const norm = Math.sqrt(g.reduce((s, x) => s + x * x, 0)) || 1;
  return g.map((x) => x / norm);
}

export class SupersawVoice implements PolyVoice<SupersawParams> {
  note = 60;
  startedAt = 0;
  releaseAt = Infinity;
  private params: SupersawParams | null = null;
  private velocity = 0;
  private amp = new Envelope();
  private fenv = new Envelope();
  private phases = new Float64Array(MAX_SAWS);
  private drifts = new Float64Array(MAX_SAWS);
  private targets = new Float64Array(MAX_SAWS);
  private driftCount = 0;
  private sub = 0;
  private lp = new Svf();

  constructor(private readonly random: () => number = Math.random) {}

  get active(): boolean {
    return this.amp.stage !== Stage.Idle;
  }

  start(note: number, velocity: number, frame: number, releaseAt: number, params: SupersawParams | null): void {
    if (!this.active) {
      for (let i = 0; i < MAX_SAWS; i++) this.phases[i] = this.random();
      this.lp.reset();
    }
    this.note = note;
    this.velocity = velocity;
    this.startedAt = frame;
    this.releaseAt = releaseAt;
    this.params = params;
    this.amp.trigger();
    this.fenv.trigger();
  }

  release(): void {
    this.releaseAt = Infinity;
    this.amp.release();
    this.fenv.release();
  }

  render(live: SupersawParams, sr: number): number {
    const p = this.params ?? live;
    const n = Math.max(1, Math.min(MAX_SAWS, Math.round(p.voices)));
    if (--this.driftCount <= 0) {
      for (let i = 0; i < n; i++) this.targets[i] = (this.random() * 2 - 1) * p.drift;
      this.driftCount = Math.round(sr * 0.3);
    }
    const hz = midiToHz(this.note);
    const cents = MAX_CENTS * p.detune * p.detune;
    const gains = sawGains(n, p.blend);
    let x = 0;
    for (let i = 0; i < n; i++) {
      this.drifts[i] += (this.targets[i] - this.drifts[i]) * (3 / sr);
      const f = hz * Math.pow(2, (sawSpread(i, n) * cents + this.drifts[i]) / 1200);
      const dt = f / sr;
      const t = this.phases[i];
      x += (2 * t - 1 - blep(t, dt)) * gains[i];
      this.phases[i] = (t + dt) % 1;
    }
    this.sub = (this.sub + hz / 2 / sr) % 1;
    // A rounded saw (two harmonics) an octave down.
    const s = this.sub * Math.PI * 2;
    x += (Math.sin(s) + 0.3 * Math.sin(2 * s)) * p.sub;
    const amp = this.amp.next(p, sr);
    const fe = this.fenv.next({ attack: 0.002, decay: p.filterDecay, sustain: 0, release: p.release }, sr);
    this.lp.run(x, p.cutoff * Math.pow(2, p.filterEnv * fe), p.resonance, sr);
    return this.lp.low * amp * this.velocity * 0.8;
  }
}
