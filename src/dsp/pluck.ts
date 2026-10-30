import { midiToHz } from './fm';
import type { PolyVoice } from './poly';

/** Karplus-Strong plucked string: a burst of noise ringing round a tuned, damped delay line. */
export interface PluckParams {
  /** Seconds for the string to fade by 60 dB. */
  decay: number;
  /** 0 is dull (classic averaging filter), 1 barely damps. */
  brightness: number;
  /** Brightness of the pluck itself (the noise burst). */
  pluck: number;
  /** Where along the string it's plucked; 0.5 is the middle (hollow), near 0 is by the bridge (twangy). */
  position: number;
  /** Seconds to die away once the note ends. */
  release: number;
  level: number;
}

export function defaultPluckParams(): PluckParams {
  return { decay: 2, brightness: 0.5, pluck: 0.7, position: 0.13, release: 0.3, level: 0.8 };
}

const MIN_HZ = 20;
const SILENT = 1e-4;

export class PluckVoice implements PolyVoice<PluckParams> {
  note = 60;
  startedAt = 0;
  releaseAt = Infinity;
  private params: PluckParams | null = null;
  private buf: Float32Array;
  private write = 0;
  private prev = 0;
  private released = false;
  private level = 0;
  private peak = 0;
  private sincePeak = 0;
  private alive = false;

  constructor(
    private readonly sr: number,
    private readonly random: () => number = Math.random,
  ) {
    this.buf = new Float32Array(Math.ceil(sr / MIN_HZ) + 2);
  }

  get active(): boolean {
    return this.alive;
  }

  start(note: number, velocity: number, frame: number, releaseAt: number, params: PluckParams | null): void {
    this.note = note;
    this.startedAt = frame;
    this.releaseAt = releaseAt;
    this.params = params;
    this.released = false;
    this.alive = true;
    this.level = 1;
    this.peak = 0;
    this.sincePeak = 0;
    // The pluck: noise, low-passed by Pluck, then combed by Position, written over one period of the line.
    const p = params;
    const period = Math.max(2, Math.min(this.buf.length - 2, Math.round(this.sr / midiToHz(note))));
    const pluck = p?.pluck ?? 0.7;
    const position = p?.position ?? 0.13;
    const burst = new Float32Array(period);
    let lp = 0;
    for (let i = 0; i < period; i++) {
      lp += (this.random() * 2 - 1 - lp) * (0.05 + 0.95 * pluck);
      burst[i] = lp;
    }
    const offset = Math.round(position * period);
    for (let i = 0; i < period; i++) {
      const v = (burst[i] - (offset ? burst[(i - offset + period) % period] : 0) * 0.9) * velocity;
      this.buf[(this.write - period + i + this.buf.length) % this.buf.length] += v;
    }
  }

  release(): void {
    this.releaseAt = Infinity;
    this.released = true;
  }

  render(live: PluckParams, sr: number): number {
    if (!this.alive) return 0;
    const p = this.params ?? live;
    const hz = midiToHz(this.note);
    const n = this.buf.length;
    // Linear interpolation for the fractional part of the period keeps high notes in tune.
    const d = Math.min(n - 2, sr / hz);
    const pos = this.write - d;
    const i0 = Math.floor(pos);
    const f = pos - i0;
    const a = this.buf[(i0 + n) % n];
    const b = this.buf[(i0 + 1 + n) % n];
    const x = a + (b - a) * f;
    // Feedback for a 60 dB fade over Decay seconds, faster once the note is released.
    const fade = this.released ? Math.min(p.decay, p.release) : p.decay;
    const g = Math.pow(0.001, 1 / Math.max(1, fade * hz));
    const s = 0.5 * (1 - p.brightness);
    const y = g * ((1 - s) * x + s * this.prev);
    this.prev = x;
    this.buf[this.write] = y;
    this.write = (this.write + 1) % n;
    // Stop when it has been quiet for a whole period.
    const ay = Math.abs(y);
    if (ay > this.peak) this.peak = ay;
    if (++this.sincePeak > d) {
      if (this.peak < SILENT) {
        this.alive = false;
        this.buf.fill(0);
      }
      this.peak = 0;
      this.sincePeak = 0;
    }
    return x * this.level;
  }
}
