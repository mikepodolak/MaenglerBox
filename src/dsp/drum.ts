import { midiToHz } from './fm';
import type { PolyVoice } from './poly';
import { Svf } from './svf';

/**
 * FM percussion, after the drum voices of FM grooveboxes: a sine body with
 * a pitch sweep, bent by an FM modulator that dies away fast, plus a burst
 * of filtered noise. Low ratios and long sweeps make kicks and toms; high
 * ratios, noise and short decays make snares, hats and metal.
 */
export interface DrumParams {
  /** Body pitch in Hz, for C4. */
  pitch: number;
  /** How much the note's pitch moves the body, 0 (fixed drum) to 1 (fully tuned). */
  track: number;
  /** Octaves the pitch starts above the body and falls from. */
  sweep: number;
  sweepTime: number;
  ratio: number;
  /** FM amount, 0..1. */
  fm: number;
  fmDecay: number;
  feedback: number;
  /** Noise level, 0..1. */
  noise: number;
  /** Noise band centre in Hz. */
  noiseTone: number;
  noiseDecay: number;
  decay: number;
  /** Saturation, 0..1. */
  drive: number;
  level: number;
}

export function defaultDrumParams(): DrumParams {
  return {
    pitch: 55,
    track: 0,
    sweep: 2.5,
    sweepTime: 0.04,
    ratio: 1.5,
    fm: 0.2,
    fmDecay: 0.03,
    feedback: 0,
    noise: 0.05,
    noiseTone: 3000,
    noiseDecay: 0.04,
    decay: 0.45,
    drive: 0.2,
    level: 0.8,
  };
}

const TWO_PI = Math.PI * 2;
const SILENT = 1e-4;

/** Per-sample multiplier that falls 60 dB over `seconds`. */
const fall = (seconds: number, sr: number) => Math.pow(0.001, 1 / Math.max(1, seconds * sr));

export class DrumVoice implements PolyVoice<DrumParams> {
  note = 60;
  startedAt = 0;
  releaseAt = Infinity;
  private params: DrumParams | null = null;
  private velocity = 0;
  private amp = 0;
  private sweepEnv = 0;
  private fmEnv = 0;
  private noiseEnv = 0;
  private pc = 0;
  private pm = 0;
  private fb = 0;
  private bp = new Svf();

  constructor(private readonly random: () => number = Math.random) {}

  get active(): boolean {
    return this.amp > SILENT || this.noiseEnv > SILENT;
  }

  start(note: number, velocity: number, frame: number, _releaseAt: number, params: DrumParams | null): void {
    this.note = note;
    this.velocity = velocity;
    this.startedAt = frame;
    // A drum rings out whatever the note length.
    this.releaseAt = Infinity;
    this.params = params;
    this.amp = 1;
    this.sweepEnv = 1;
    this.fmEnv = 1;
    this.noiseEnv = 1;
    // Each hit starts from zero phase, so kicks click the same every time.
    this.pc = 0;
    this.pm = 0;
    this.fb = 0;
  }

  release(): void {
    this.releaseAt = Infinity;
  }

  render(live: DrumParams, sr: number): number {
    const p = this.params ?? live;
    const base = p.pitch * Math.pow(midiToHz(this.note) / midiToHz(60), p.track);
    const hz = base * Math.pow(2, p.sweep * this.sweepEnv);
    const m = Math.sin(TWO_PI * this.pm + this.fb * p.feedback * Math.PI);
    this.fb = m;
    const body = Math.sin(TWO_PI * this.pc + m * p.fm * this.fmEnv * TWO_PI * 2);
    this.pc += hz / sr;
    this.pc -= Math.floor(this.pc);
    this.pm += (hz * p.ratio) / sr;
    this.pm -= Math.floor(this.pm);
    this.bp.run(this.random() * 2 - 1, p.noiseTone, 1.2, sr);
    const x = body * this.amp * (1 - p.noise * 0.5) + this.bp.band * this.noiseEnv * p.noise * 2;
    this.amp *= fall(p.decay, sr);
    this.sweepEnv *= fall(p.sweepTime, sr);
    this.fmEnv *= fall(p.fmDecay, sr);
    this.noiseEnv *= fall(p.noiseDecay, sr);
    const d = 1 + p.drive * 8;
    return (Math.tanh(x * d) / Math.tanh(d)) * this.velocity;
  }
}
