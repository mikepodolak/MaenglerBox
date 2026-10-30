/**
 * 4-operator FM (phase modulation) synth, DX/Digitone style.
 *
 * Pure DSP with no Web Audio dependency, so it runs inside an AudioWorklet
 * and in unit tests alike. Operators are numbered 1..4 in the UI and 0..3
 * here. Modulators always have a higher index than what they modulate, so
 * rendering from op 4 down to op 1 sees every modulator's current output.
 */

export interface Algorithm {
  /** [modulator, target] pairs, 0-based. */
  mods: [number, number][];
  /** Operators whose output is heard. */
  carriers: number[];
}

/** Op 4 always has self-feedback. Drawn as modulator → target. */
export const ALGORITHMS: Algorithm[] = [
  { mods: [[3, 2], [2, 1], [1, 0]], carriers: [0] }, // 1: 4→3→2→1
  { mods: [[3, 2], [2, 0], [1, 0]], carriers: [0] }, // 2: 4→3→1 ← 2
  { mods: [[3, 1], [2, 1], [1, 0]], carriers: [0] }, // 3: (4+3)→2→1
  { mods: [[3, 0], [2, 0], [1, 0]], carriers: [0] }, // 4: (4+3+2)→1
  { mods: [[3, 2], [1, 0]], carriers: [0, 2] }, // 5: 4→3, 2→1
  { mods: [[3, 2], [3, 1], [3, 0]], carriers: [0, 1, 2] }, // 6: 4→(3,2,1)
  { mods: [[3, 2]], carriers: [0, 1, 2] }, // 7: 4→3, plus 2 and 1
  { mods: [], carriers: [0, 1, 2, 3] }, // 8: additive
];

export const ALGORITHM_DIAGRAMS = [
  '4→3→2→1',
  '4→3→1←2',
  '(4+3)→2→1',
  '(4+3+2)→1',
  '4→3  2→1',
  '4→(3,2,1)',
  '4→3  2  1',
  '4  3  2  1',
];

export interface OpParams {
  ratio: number;
  /** Detune in cents. */
  fine: number;
  /** Output level 0..1. For modulators this is the modulation depth. */
  level: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface FMParams {
  algorithm: number;
  feedback: number;
  level: number;
  ops: OpParams[];
}

export interface NoteEvent {
  time: number;
  note: number;
  velocity: number;
  length: number;
  /** Settings for this note only, e.g. a preset picked by the sequencer step. */
  params?: FMParams;
}

const TWO_PI = Math.PI * 2;
/** Modulation index at level 1, in radians. */
const MOD_DEPTH = TWO_PI * 1.5;
const ENV_FLOOR = 1e-4;

export const enum Stage {
  Idle,
  Attack,
  Decay,
  Sustain,
  Release,
}

/** The four stage times and sustain level an envelope reads. */
export interface EnvParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export class Envelope {
  stage = Stage.Idle;
  value = 0;

  trigger(): void {
    this.stage = Stage.Attack;
  }

  release(): void {
    if (this.stage !== Stage.Idle) this.stage = Stage.Release;
  }

  next(p: EnvParams, sr: number): number {
    switch (this.stage) {
      case Stage.Attack:
        this.value += 1 / Math.max(1, p.attack * sr);
        if (this.value >= 1) {
          this.value = 1;
          this.stage = Stage.Decay;
        }
        break;
      case Stage.Decay:
        // Exponential approach; a quarter of the stage time per time constant reaches ~98%.
        this.value = p.sustain + (this.value - p.sustain) * coef(p.decay, sr);
        if (Math.abs(this.value - p.sustain) < ENV_FLOOR) this.stage = Stage.Sustain;
        break;
      case Stage.Sustain:
        this.value = p.sustain;
        break;
      case Stage.Release:
        this.value *= coef(p.release, sr);
        if (this.value < ENV_FLOOR) {
          this.value = 0;
          this.stage = Stage.Idle;
        }
        break;
      case Stage.Idle:
        break;
    }
    return this.value;
  }
}

function coef(seconds: number, sr: number): number {
  return Math.exp(-4 / Math.max(1, seconds * sr));
}

export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

class Voice {
  /** Per-note settings; null follows the synth's live settings. */
  params: FMParams | null = null;
  note = 60;
  velocity = 0;
  startedAt = 0;
  releaseAt = Infinity;
  phase = [0, 0, 0, 0];
  out = [0, 0, 0, 0];
  envs = [new Envelope(), new Envelope(), new Envelope(), new Envelope()];
  fb1 = 0;
  fb2 = 0;

  get active(): boolean {
    return this.envs.some((e) => e.stage !== Stage.Idle);
  }

  start(note: number, velocity: number, frame: number, releaseAt: number, params: FMParams | null): void {
    this.params = params;
    this.note = note;
    this.velocity = velocity;
    this.startedAt = frame;
    this.releaseAt = releaseAt;
    for (const e of this.envs) e.trigger();
  }

  release(): void {
    this.releaseAt = Infinity;
    for (const e of this.envs) e.release();
  }

  render(p: FMParams, alg: Algorithm, sr: number): number {
    const base = midiToHz(this.note);
    const mod = [0, 0, 0, 0];
    for (let k = 3; k >= 0; k--) {
      const op = p.ops[k];
      const env = this.envs[k].next(op, sr);
      let pm = mod[k];
      if (k === 3) pm += p.feedback * ((this.fb1 + this.fb2) / 2) * Math.PI;
      const y = Math.sin(TWO_PI * this.phase[k] + pm) * env * op.level;
      this.out[k] = y;
      if (k === 3) {
        this.fb2 = this.fb1;
        this.fb1 = y;
      }
      for (const [src, dst] of alg.mods) if (src === k) mod[dst] += y * MOD_DEPTH;
      this.phase[k] += (base * op.ratio * Math.pow(2, op.fine / 1200)) / sr;
      this.phase[k] -= Math.floor(this.phase[k]);
    }
    let sum = 0;
    for (const c of alg.carriers) sum += this.out[c];
    return (sum / Math.sqrt(alg.carriers.length)) * this.velocity;
  }
}

export function defaultFMParams(): FMParams {
  return {
    algorithm: 0,
    feedback: 0.1,
    level: 0.8,
    ops: [
      { ratio: 1, fine: 0, level: 1, attack: 0.002, decay: 0.5, sustain: 0, release: 0.2 },
      { ratio: 2, fine: 0, level: 0.45, attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
      { ratio: 3.5, fine: 0, level: 0.25, attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
      { ratio: 7, fine: 0, level: 0.15, attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    ],
  };
}

/** Polyphonic FM synth with sample-accurate note scheduling. */
export class FMSynth {
  params: FMParams = defaultFMParams();
  private voices: Voice[];
  private queue: { frame: number; ev: NoteEvent }[] = [];

  constructor(
    readonly sampleRate: number,
    polyphony = 6,
  ) {
    this.voices = Array.from({ length: polyphony }, () => new Voice());
  }

  /** Queue a note. `time` is in seconds on the audio clock. */
  schedule(ev: NoteEvent): void {
    const frame = Math.round(ev.time * this.sampleRate);
    this.insert({ frame, ev });
  }

  allOff(): void {
    this.queue = [];
    for (const v of this.voices) v.release();
  }

  get activeVoices(): number {
    return this.voices.filter((v) => v.active).length;
  }

  /** Render `out.length` samples starting at absolute frame `startFrame`. */
  process(out: Float32Array, startFrame: number): void {
    const p = this.params;
    const alg = ALGORITHMS[Math.round(p.algorithm)] ?? ALGORITHMS[0];
    const sr = this.sampleRate;
    for (let i = 0; i < out.length; i++) {
      const frame = startFrame + i;
      while (this.queue.length && this.queue[0].frame <= frame) this.apply(this.queue.shift()!, frame);
      let sum = 0;
      for (const v of this.voices) {
        if (v.releaseAt <= frame) v.release();
        if (!v.active) continue;
        const vp = v.params;
        // The module's level stays the master volume even for notes using a preset.
        sum += vp ? v.render(vp, ALGORITHMS[Math.round(vp.algorithm)] ?? alg, sr) : v.render(p, alg, sr);
      }
      out[i] = sum * p.level * 0.5;
    }
  }

  private apply({ ev }: { ev: NoteEvent }, frame: number): void {
    const voice = this.pickVoice(ev.note);
    const releaseAt = frame + Math.max(1, Math.round(ev.length * this.sampleRate));
    voice.start(ev.note, Math.min(1, Math.max(0, ev.velocity)), frame, releaseAt, ev.params ?? null);
  }

  /** Reuse a voice already on this note, then a free voice, else steal the oldest. */
  private pickVoice(note: number): Voice {
    return (
      this.voices.find((v) => v.active && v.note === note) ??
      this.voices.find((v) => !v.active) ??
      this.voices.reduce((a, b) => (b.startedAt < a.startedAt ? b : a))
    );
  }

  private insert(item: { frame: number; ev: NoteEvent }): void {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > item.frame) i--;
    this.queue.splice(i, 0, item);
  }
}
