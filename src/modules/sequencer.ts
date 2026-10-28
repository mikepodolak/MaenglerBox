import { GateOutput, type GateEvent } from '../engine/gate';
import type { ModuleDataDef } from '../patch/types';
import type { ModuleType } from './types';

export const MAX_STEPS = 32;

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export interface Step {
  on: boolean;
  /** MIDI note. */
  note: number;
  /** 0..1 */
  velocity: number;
  /** Chance this step fires, 0..1. */
  chance: number;
  /** Hits per step, 1..4. */
  ratchet: number;
  /** Gate length as a fraction of the step (or ratchet slice). */
  length: number;
}

export interface SequencerData {
  steps: Step[];
}

export const SCALES: { name: string; intervals: number[] }[] = [
  { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { name: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'Minor pent.', intervals: [0, 3, 5, 7, 10] },
  { name: 'Whole tone', intervals: [0, 2, 4, 6, 8, 10] },
];

export function defaultStep(i: number): Step {
  // A sparse starting groove so the first patch is already musical.
  const on = [0, 3, 6, 8, 11, 14].includes(i % 16);
  return { on, note: 48 + ([0, 7, 3, 12, 10, 5][i % 6] ?? 0), velocity: 0.8, chance: i % 4 === 0 ? 1 : 0.7, ratchet: 1, length: 0.5 };
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export const sequencerData: ModuleDataDef<SequencerData> = {
  create: () => ({ steps: Array.from({ length: MAX_STEPS }, (_, i) => defaultStep(i)) }),
  normalize(raw) {
    const src = typeof raw === 'object' && raw !== null && Array.isArray((raw as SequencerData).steps) ? (raw as SequencerData).steps : [];
    return {
      steps: Array.from({ length: MAX_STEPS }, (_, i) => {
        const d = defaultStep(i);
        const s = src[i] as Partial<Step> | undefined;
        if (typeof s !== 'object' || s === null) return d;
        return {
          on: typeof s.on === 'boolean' ? s.on : d.on,
          note: Math.round(clamp(s.note, 0, 127, d.note)),
          velocity: clamp(s.velocity, 0, 1, d.velocity),
          chance: clamp(s.chance, 0, 1, d.chance),
          ratchet: Math.round(clamp(s.ratchet, 1, 4, d.ratchet)),
          length: clamp(s.length, 0.05, 1, d.length),
        };
      }),
    };
  },
};

/** Snap a note to the nearest degree of a scale rooted at `root` (pitch class). */
export function quantize(note: number, scale: number[], root = 0): number {
  const rel = note - root;
  const octave = Math.floor(rel / 12);
  const pc = rel - octave * 12;
  let best = scale[0];
  for (const deg of [...scale, 12]) if (Math.abs(deg - pc) < Math.abs(best - pc)) best = deg;
  return root + octave * 12 + best;
}

export interface SequencerSettings {
  length: number;
  /** Global multiplier on every step's chance. */
  density: number;
  /** Max random pitch offset, in semitones. */
  pitchRandom: number;
  /** Chance that a note jumps an octave up or down. */
  octaveRandom: number;
  scale: number;
  root: number;
  transpose: number;
}

/**
 * The sequencer's decision logic, separated from audio so it can be tested
 * with a seeded random source.
 */
export class SequencerCore {
  position = -1;
  /** Recent (time, step) pairs, so the UI can show what's sounding now rather than what's scheduled. */
  private history: { time: number; step: number }[] = [];
  private lastClock: number | null = null;
  private interval = 0.125;

  constructor(
    public data: SequencerData,
    public settings: SequencerSettings,
    private readonly random: () => number = Math.random,
  ) {}

  reset(): void {
    this.position = -1;
  }

  /** Advance one step on a clock pulse and return the notes to play. */
  clock(time: number, clockLength?: number): GateEvent[] {
    if (this.lastClock !== null && time > this.lastClock) this.interval = time - this.lastClock;
    else if (clockLength) this.interval = clockLength * 2;
    this.lastClock = time;

    const len = Math.max(1, Math.min(MAX_STEPS, Math.round(this.settings.length)));
    this.position = (this.position + 1) % len;
    this.history.push({ time, step: this.position });
    if (this.history.length > 16) this.history.shift();
    const step = this.data.steps[this.position];
    if (!step?.on) return [];
    if (this.random() >= step.chance * this.settings.density) return [];

    const note = this.pickNote(step.note);
    const slice = this.interval / step.ratchet;
    const events: GateEvent[] = [];
    for (let r = 0; r < step.ratchet; r++) {
      events.push({
        time: time + r * slice,
        value: step.velocity * (r === 0 ? 1 : 0.85),
        length: Math.max(0.005, slice * step.length),
        note,
      });
    }
    return events;
  }

  /** The step sounding at audio time `now`, or -1 before the first clock. */
  stepAt(now: number): number {
    let step = -1;
    for (const h of this.history) if (h.time <= now) step = h.step;
    return step;
  }

  private pickNote(base: number): number {
    const s = this.settings;
    let note = base + s.transpose;
    if (s.pitchRandom > 0) note += Math.round((this.random() * 2 - 1) * s.pitchRandom);
    if (s.octaveRandom > 0 && this.random() < s.octaveRandom) note += this.random() < 0.5 ? -12 : 12;
    const scale = SCALES[Math.round(s.scale)] ?? SCALES[0];
    return Math.min(127, Math.max(0, quantize(note, scale.intervals, Math.round(s.root))));
  }
}

export function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/** Step sequencer where every step has its own chance, ratchet, velocity and length. */
export const sequencer: ModuleType = {
  def: {
    type: 'sequencer',
    label: 'Chance Sequencer',
    description: 'Step sequencer with per-step chance, ratchets, and pitch randomness locked to a scale.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: [{ id: 'out', label: 'Notes', kind: 'gate' }],
    params: [
      { id: 'length', label: 'Length', min: 1, max: MAX_STEPS, default: 16, step: 1 },
      { id: 'density', label: 'Density', min: 0, max: 1, default: 1, step: 0.01 },
      { id: 'pitchRandom', label: 'Pitch rnd', min: 0, max: 12, default: 0, step: 1, unit: 'st' },
      { id: 'octaveRandom', label: 'Octave rnd', min: 0, max: 1, default: 0, step: 0.01 },
      { id: 'scale', label: 'Scale', min: 0, max: SCALES.length - 1, default: 1, step: 1, options: SCALES.map((s) => s.name) },
      { id: 'root', label: 'Root', min: 0, max: 11, default: 0, step: 1, options: NOTE_NAMES },
      { id: 'transpose', label: 'Transpose', min: -24, max: 24, default: 0, step: 1, unit: 'st' },
    ],
    face: ['density', 'pitchRandom'],
    data: sequencerData as ModuleDataDef,
  },
  create(_env, params, data) {
    const out = new GateOutput();
    const core = new SequencerCore(sequencerData.normalize(data), { ...(params as unknown as SequencerSettings) });
    return {
      inputs: {
        clock: { kind: 'gate', handler: (e) => core.clock(e.time, e.length).forEach((ev) => out.emit(ev)) },
        reset: { kind: 'gate', handler: () => core.reset() },
      },
      outputs: { out: { kind: 'gate', out } },
      setParam(id, v) {
        (core.settings as unknown as Record<string, number>)[id] = v;
      },
      setData(d) {
        core.data = sequencerData.normalize(d);
      },
      getState: (now) => ({ step: core.stepAt(now) }),
      dispose() {},
    };
  },
};
