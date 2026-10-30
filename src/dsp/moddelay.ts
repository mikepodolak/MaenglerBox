export interface ModDelaySettings {
  /** Base delay, seconds. */
  delay: number;
  /** LFO sweeping the delay: cycles per second and depth in seconds. */
  rate: number;
  depth: number;
  /** -0.98..0.98; negative inverts what's fed back (hollower flanges, odd-harmonic combs). */
  feedback: number;
  /** 0..1, how much the feedback is darkened each pass. */
  damp: number;
  mix: number;
}

/** A new base delay at an audio-clock time, e.g. a comb retuned by a note. */
export interface ModDelayEvent {
  time: number;
  delay: number;
}

const MAX_SECONDS = 0.1;

/**
 * A short delay line with feedback, swept by its own LFO, read with
 * interpolation so it can go down to a sample or two. Web Audio's own delay
 * can't feed back faster than 128 samples, which rules out flangers and
 * tuned combs; this runs per sample in a worklet instead.
 */
export class ModDelayCore {
  settings: ModDelaySettings = { delay: 0.003, rate: 0.25, depth: 0.002, feedback: 0.5, damp: 0, mix: 0.5 };
  private buf: Float32Array;
  private write = 0;
  private phase = 0;
  private lp = 0;
  private events: (ModDelayEvent & { frame: number })[] = [];

  constructor(private readonly sampleRate: number) {
    this.buf = new Float32Array(Math.ceil(sampleRate * MAX_SECONDS) + 4);
  }

  schedule(e: ModDelayEvent): void {
    this.events.push({ ...e, frame: Math.round(e.time * this.sampleRate) });
    this.events.sort((a, b) => a.frame - b.frame);
  }

  process(input: Float32Array | undefined, out: Float32Array, start: number): void {
    const s = this.settings;
    const n = this.buf.length;
    const maxDelay = n - 3;
    const fb = Math.max(-0.98, Math.min(0.98, s.feedback));
    const damp = Math.max(0, Math.min(0.95, s.damp));
    for (let i = 0; i < out.length; i++) {
      while (this.events.length && this.events[0].frame <= start + i) s.delay = this.events.shift()!.delay;
      const sweep = s.depth * 0.5 * (1 - Math.cos(2 * Math.PI * this.phase));
      this.phase = (this.phase + s.rate / this.sampleRate) % 1;
      const d = Math.max(1, Math.min(maxDelay, (s.delay + sweep) * this.sampleRate));
      const pos = this.write - d;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = this.buf[(i0 + n) % n];
      const b = this.buf[(i0 + 1 + n) % n];
      const delayed = a + (b - a) * frac;
      this.lp = delayed + (this.lp - delayed) * damp;
      const x = input ? input[i] : 0;
      this.buf[this.write] = x + this.lp * fb;
      this.write = (this.write + 1) % n;
      out[i] = x * (1 - s.mix) + delayed * s.mix;
    }
  }
}
