/** A note for a polyphonic synth, on the audio clock. */
export interface PolyNote<P> {
  time: number;
  note: number;
  velocity: number;
  length: number;
  /** Settings for this note only (a preset or parameter locks). */
  params?: P;
}

export interface PolyVoice<P> {
  note: number;
  startedAt: number;
  releaseAt: number;
  readonly active: boolean;
  start(note: number, velocity: number, frame: number, releaseAt: number, params: P | null): void;
  release(): void;
  /** One sample, using the note's own settings if it has them, else `p`. */
  render(p: P, sr: number): number;
}

/**
 * Voice allocation and sample-accurate note scheduling shared by the
 * synths: notes are queued by frame, a voice already on the note is reused,
 * then a free one, else the oldest is stolen.
 */
export class PolySynth<P> {
  private voices: PolyVoice<P>[];
  private queue: { frame: number; ev: PolyNote<P> }[] = [];

  constructor(
    readonly sampleRate: number,
    public params: P,
    makeVoice: () => PolyVoice<P>,
    polyphony = 6,
  ) {
    this.voices = Array.from({ length: polyphony }, makeVoice);
  }

  schedule(ev: PolyNote<P>): void {
    const frame = Math.round(ev.time * this.sampleRate);
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > frame) i--;
    this.queue.splice(i, 0, { frame, ev });
  }

  allOff(): void {
    this.queue = [];
    for (const v of this.voices) v.release();
  }

  get activeVoices(): number {
    return this.voices.filter((v) => v.active).length;
  }

  process(out: Float32Array, startFrame: number, gain: number): void {
    for (let i = 0; i < out.length; i++) {
      const frame = startFrame + i;
      while (this.queue.length && this.queue[0].frame <= frame) {
        const { ev } = this.queue.shift()!;
        const v = this.pick(ev.note);
        v.start(ev.note, Math.min(1, Math.max(0, ev.velocity)), frame, frame + Math.max(1, Math.round(ev.length * this.sampleRate)), ev.params ?? null);
      }
      let sum = 0;
      for (const v of this.voices) {
        if (v.releaseAt <= frame) v.release();
        if (v.active) sum += v.render(this.params, this.sampleRate);
      }
      out[i] = sum * gain;
    }
  }

  private pick(note: number): PolyVoice<P> {
    return (
      this.voices.find((v) => v.active && v.note === note) ??
      this.voices.find((v) => !v.active) ??
      this.voices.reduce((a, b) => (b.startedAt < a.startedAt ? b : a))
    );
  }
}
