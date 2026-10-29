export const LFO_SHAPES = ['Sine', 'Triangle', 'Ramp up', 'Ramp down', 'Square', 'Random', 'Smooth random'];

export interface LfoSettings {
  /** Cycles per second. */
  rate: number;
  shape: number;
  /** 0..1 instead of -1..1. */
  unipolar: boolean;
  level: number;
}

/** Something to do at an audio-clock time: restart the cycle, or change speed (clock sync). */
export interface LfoEvent {
  time: number;
  reset?: boolean;
  rate?: number;
}

/** One cycle of a shape at phase 0..1, -1..1. Random shapes go from `from` to `to` across the cycle. */
export function lfoShape(shape: number, phase: number, from = 0, to = 0): number {
  switch (shape) {
    case 0:
      return Math.sin(2 * Math.PI * phase);
    case 1:
      return phase < 0.25 ? phase * 4 : phase < 0.75 ? 2 - phase * 4 : phase * 4 - 4;
    case 2:
      return phase * 2 - 1;
    case 3:
      return 1 - phase * 2;
    case 4:
      return phase < 0.5 ? 1 : -1;
    case 5:
      return from;
    default:
      return from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * phase));
  }
}

/**
 * The LFO itself, shared by the worklet and the tests. Runs sample by sample
 * so a reset or a rate change from the clock lands on its exact frame.
 */
export class LfoCore {
  phase = 0;
  settings: LfoSettings = { rate: 1, shape: 0, unipolar: false, level: 1 };
  private from = 0;
  private to: number;
  private events: (LfoEvent & { frame: number })[] = [];

  constructor(
    private readonly sampleRate: number,
    private readonly random: () => number = Math.random,
  ) {
    this.to = this.random() * 2 - 1;
  }

  schedule(e: LfoEvent): void {
    this.events.push({ ...e, frame: Math.round(e.time * this.sampleRate) });
    this.events.sort((a, b) => a.frame - b.frame);
  }

  private wrap(): void {
    this.from = this.to;
    this.to = this.random() * 2 - 1;
  }

  /** Fill `out` starting at absolute frame `start`. */
  process(out: Float32Array, start: number): void {
    const s = this.settings;
    for (let i = 0; i < out.length; i++) {
      while (this.events.length && this.events[0].frame <= start + i) {
        const e = this.events.shift()!;
        if (e.rate !== undefined) s.rate = e.rate;
        if (e.reset) {
          this.phase = 0;
          this.wrap();
        }
      }
      const v = lfoShape(s.shape, this.phase, this.from, this.to);
      out[i] = (s.unipolar ? (v + 1) / 2 : v) * s.level;
      this.phase += s.rate / this.sampleRate;
      if (this.phase >= 1) {
        this.phase -= Math.floor(this.phase);
        this.wrap();
      }
    }
  }
}
