export interface GlitchSettings {
  /** Chance each trigger starts a stutter, 0..1. */
  chance: number;
  /** How many times a stutter repeats its slice. */
  repeats: number;
  /** Chance a stutter plays its slice backwards. */
  reverse: number;
  /** Bit depth, 1..16 (16 is clean). */
  bits: number;
  /** Keep every Nth sample (1 is clean). */
  downsample: number;
  /** Wet level, 0..1. */
  mix: number;
}

/** A trigger at an audio-clock time, grabbing the last `slice` seconds. */
export interface GlitchTrigger {
  time: number;
  slice: number;
}

const BUFFER_SECONDS = 4;

/**
 * Stutter, reverse and bit-crush. It keeps recording its input; a trigger
 * (with the given chance) grabs the slice just played and loops it a few
 * times, sometimes backwards, in place of the live sound.
 */
export class GlitchCore {
  settings: GlitchSettings = { chance: 0.3, repeats: 4, reverse: 0.2, bits: 16, downsample: 1, mix: 1 };
  private buf: Float32Array;
  private write = 0;
  private triggers: (GlitchTrigger & { frame: number })[] = [];
  private stutter: { start: number; len: number; pos: number; total: number; reverse: boolean } | null = null;
  private held = 0;
  private hold = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly random: () => number = Math.random,
  ) {
    this.buf = new Float32Array(Math.round(sampleRate * BUFFER_SECONDS));
  }

  trigger(t: GlitchTrigger): void {
    this.triggers.push({ ...t, frame: Math.round(t.time * this.sampleRate) });
    this.triggers.sort((a, b) => a.frame - b.frame);
  }

  get stuttering(): boolean {
    return this.stutter !== null;
  }

  process(input: Float32Array | undefined, out: Float32Array, start: number): void {
    const s = this.settings;
    const n = this.buf.length;
    const levels = Math.pow(2, Math.max(1, Math.min(16, s.bits)) - 1);
    const every = Math.max(1, Math.round(s.downsample));
    for (let i = 0; i < out.length; i++) {
      while (this.triggers.length && this.triggers[0].frame <= start + i) {
        const t = this.triggers.shift()!;
        if (this.random() < s.chance) {
          const len = Math.max(32, Math.min(n - 1, Math.round(t.slice * this.sampleRate)));
          this.stutter = { start: (this.write - len + n) % n, len, pos: 0, total: len * Math.max(1, Math.round(s.repeats)), reverse: this.random() < s.reverse };
        }
      }
      const dry = input ? input[i] : 0;
      this.buf[this.write] = dry;
      this.write = (this.write + 1) % n;
      let wet = dry;
      const st = this.stutter;
      if (st) {
        const p = st.pos % st.len;
        wet = this.buf[(st.start + (st.reverse ? st.len - 1 - p : p)) % n];
        if (++st.pos >= st.total) this.stutter = null;
      }
      // Sample-rate reduction holds a value for several samples; bit reduction rounds it to fewer steps.
      if (this.hold++ % every === 0) this.held = wet;
      wet = s.bits >= 16 ? this.held : Math.round(this.held * levels) / levels;
      out[i] = dry * (1 - s.mix) + wet * s.mix;
    }
  }
}
