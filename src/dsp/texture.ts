import { Envelope, midiToHz, Stage } from './fm';
import type { PolyVoice } from './poly';
import { Svf } from './svf';

/**
 * Texture voice: each note is a cloud of short grains around its pitch,
 * each grain a sine or a band of noise, scattered in pitch. Sparse and
 * pitched it glitters; dense and noisy it hisses and breathes.
 */
export interface TextureParams {
  /** Grains started per second. */
  density: number;
  /** Grain length in seconds. */
  grain: number;
  /** How far grains scatter from the note, in semitones. */
  scatter: number;
  /** 0 scatters freely; 1 lands every grain on octaves and fifths. */
  harmonic: number;
  /** 0 is sine grains, 1 is bands of noise. */
  noise: number;
  /** How narrow the noise bands are. */
  focus: number;
  attack: number;
  release: number;
  level: number;
}

export function defaultTextureParams(): TextureParams {
  return { density: 30, grain: 0.08, scatter: 12, harmonic: 0.5, noise: 0.3, focus: 8, attack: 0.5, release: 1.5, level: 0.7 };
}

const MAX_GRAINS = 24;
const HARMONICS = [-12, -5, 0, 7, 12, 19, 24];

interface Grain {
  hz: number;
  phase: number;
  /** Position through the grain, 0..1, and how far it moves each sample. */
  t: number;
  dt: number;
  gain: number;
  svf: Svf;
}

export class TextureVoice implements PolyVoice<TextureParams> {
  note = 60;
  startedAt = 0;
  releaseAt = Infinity;
  private params: TextureParams | null = null;
  private velocity = 0;
  private amp = new Envelope();
  private grains: Grain[] = [];
  private pool: Grain[] = Array.from({ length: MAX_GRAINS }, () => ({ hz: 0, phase: 0, t: 1, dt: 0, gain: 0, svf: new Svf() }));
  private untilNext = 0;

  constructor(private readonly random: () => number = Math.random) {}

  get active(): boolean {
    return this.amp.stage !== Stage.Idle || this.grains.length > 0;
  }

  start(note: number, velocity: number, frame: number, releaseAt: number, params: TextureParams | null): void {
    this.note = note;
    this.velocity = velocity;
    this.startedAt = frame;
    this.releaseAt = releaseAt;
    this.params = params;
    this.amp.trigger();
    this.untilNext = 0;
  }

  release(): void {
    this.releaseAt = Infinity;
    this.amp.release();
  }

  private spawn(p: TextureParams, sr: number): void {
    const g = this.pool.find((x) => !this.grains.includes(x));
    if (!g) return;
    const free = (this.random() * 2 - 1) * p.scatter;
    const near = HARMONICS.filter((h) => Math.abs(h) <= Math.max(p.scatter, 0.5));
    const snapped = near[Math.floor(this.random() * near.length)] ?? 0;
    const st = this.random() < p.harmonic ? snapped : free;
    g.hz = midiToHz(this.note + st);
    g.phase = this.random();
    g.t = 0;
    // Lengths vary a little so the cloud doesn't pulse.
    g.dt = 1 / Math.max(8, p.grain * sr * (0.6 + this.random() * 0.8));
    g.gain = 0.5 + this.random() * 0.5;
    g.svf.reset();
    this.grains.push(g);
  }

  render(live: TextureParams, sr: number): number {
    const p = this.params ?? live;
    const amp = this.amp.next({ attack: p.attack, decay: 0.1, sustain: 1, release: p.release }, sr);
    if (this.amp.stage !== Stage.Idle && --this.untilNext <= 0) {
      this.spawn(p, sr);
      // Random gaps, averaging 1/density, so grains fall like rain.
      this.untilNext = Math.max(1, Math.round((-Math.log(1 - this.random() * 0.999) * sr) / Math.max(0.5, p.density)));
    }
    let sum = 0;
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i];
      const win = Math.sin(Math.PI * g.t) ** 2;
      const sine = Math.sin(g.phase * Math.PI * 2);
      g.svf.run(this.random() * 2 - 1, g.hz, p.focus, sr);
      sum += (sine * (1 - p.noise) + g.svf.band * p.noise * 3) * win * g.gain;
      g.phase = (g.phase + g.hz / sr) % 1;
      g.t += g.dt;
      if (g.t >= 1) this.grains.splice(i, 1);
    }
    // More overlapping grains get louder; scale back so density mostly changes the grain, not the level.
    const overlap = Math.max(1, Math.sqrt(p.density * p.grain));
    return (sum / overlap) * amp * this.velocity * 0.7;
  }
}
