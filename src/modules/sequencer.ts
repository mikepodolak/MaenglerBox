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
  /** Number sent with the step's notes, 0 = none. A synth uses 1–16 to pick a preset for that note. */
  send: number;
  /** Trig condition, one of CONDITIONS ('' = always). */
  cond: string;
  /** Parameter locks: settings of the synth this step plays, overridden for this step's notes only. */
  plocks: Record<string, number>;
}

/**
 * Trig conditions, Elektron/M8 style. 'A:B' plays on the A-th of every B loops.
 * 'pre' plays when the previous on-step played, 'first' only on the first loop.
 */
export const CONDITIONS: { id: string; label: string }[] = [
  { id: '', label: 'Always' },
  ...[2, 3, 4, 8].flatMap((b) => Array.from({ length: b }, (_, i) => ({ id: `${i + 1}:${b}`, label: `${i + 1}:${b}` }))),
  { id: 'first', label: 'First loop' },
  { id: '!first', label: 'Not first' },
  { id: 'pre', label: 'If prev played' },
  { id: '!pre', label: 'If prev silent' },
  { id: 'fill', label: 'Fill' },
  { id: '!fill', label: 'Not fill' },
];
const CONDITION_IDS = new Set(CONDITIONS.map((c) => c.id));

/** Short label for tight spaces such as tracker cells. */
export function conditionLabel(id: string): string {
  if (!id) return '';
  if (id === 'first') return '1st';
  if (id === '!first') return '!1st';
  return id.toUpperCase();
}

/** Whether a step's condition lets it play on `loop` (0-based). */
export function conditionPasses(cond: string, loop: number, prevPlayed: boolean, fill = false): boolean {
  if (!cond) return true;
  if (cond === 'first') return loop === 0;
  if (cond === '!first') return loop !== 0;
  if (cond === 'pre') return prevPlayed;
  if (cond === '!pre') return !prevPlayed;
  if (cond === 'fill') return fill;
  if (cond === '!fill') return !fill;
  const [a, b] = cond.split(':').map(Number);
  return b > 0 ? loop % b === a - 1 : true;
}

/** Max param locks on one step. */
export const MAX_PLOCKS = 8;

export const STEP_FIELDS = ['on', 'note', 'velocity', 'chance', 'ratchet', 'length', 'send'] as const;
export type StepField = (typeof STEP_FIELDS)[number];

export interface SequencerData {
  steps: Step[];
  /** Step fields that randomize and mutate leave alone. */
  locks?: StepField[];
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
  return {
    on,
    note: 48 + ([0, 7, 3, 12, 10, 5][i % 6] ?? 0),
    velocity: 0.8,
    chance: i % 4 === 0 ? 1 : 0.7,
    ratchet: 1,
    length: 0.5,
    send: 0,
    cond: '',
    plocks: {},
  };
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export const sequencerData: ModuleDataDef<SequencerData> = {
  create: () => ({ steps: Array.from({ length: MAX_STEPS }, (_, i) => defaultStep(i)), locks: [] }),
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
          send: Math.round(clamp(s.send, 0, 16, d.send)),
          cond: typeof s.cond === 'string' && CONDITION_IDS.has(s.cond) ? s.cond : '',
          plocks: normalizePlocks(s.plocks),
        };
      }),
      locks: Array.isArray((raw as SequencerData | null)?.locks)
        ? STEP_FIELDS.filter((f) => (raw as SequencerData).locks!.includes(f))
        : [],
    };
  },
};

function normalizePlocks(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [k, v] of Object.entries(raw).slice(0, MAX_PLOCKS)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export interface StepRandomizeOptions {
  /** 1 = fully random; below 1 = mutate by up to this fraction of each field's range. */
  amount: number;
  /** Only these step indices; default is the whole pattern up to `length`. */
  steps?: number[];
  length?: number;
  scale?: number;
  root?: number;
  random?: () => number;
}

/** Randomize or mutate steps, skipping locked fields. Notes stay in the sequencer's scale. */
export function randomizeSteps(data: SequencerData, opts: StepRandomizeOptions): SequencerData {
  const rnd = opts.random ?? Math.random;
  const amount = Math.min(1, Math.max(0, opts.amount));
  const full = amount >= 1;
  const locks = new Set(data.locks ?? []);
  const len = opts.length ?? MAX_STEPS;
  const targets = new Set(opts.steps ?? Array.from({ length: len }, (_, i) => i));
  const scale = (SCALES[Math.round(opts.scale ?? 0)] ?? SCALES[0]).intervals;
  const root = Math.round(opts.root ?? 0);
  const cont = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, full ? lo + rnd() * (hi - lo) : v + (rnd() * 2 - 1) * amount * (hi - lo)));

  const steps = data.steps.map((s, i) => {
    if (!targets.has(i)) return s;
    const n = { ...s };
    if (!locks.has('on') && rnd() < (full ? 1 : amount / 2)) n.on = rnd() < 0.5;
    if (!locks.has('note')) {
      const raw = full ? 36 + root + Math.floor(rnd() * 25) : s.note + Math.round((rnd() * 2 - 1) * amount * 12);
      n.note = Math.min(127, Math.max(0, quantize(raw, scale, root)));
    }
    if (!locks.has('velocity')) n.velocity = cont(s.velocity, 0.2, 1);
    if (!locks.has('chance')) n.chance = cont(s.chance, 0.1, 1);
    if (!locks.has('length')) n.length = cont(s.length, 0.05, 1);
    // Ratchets are a spice: mostly single hits even when fully random.
    if (!locks.has('ratchet') && rnd() < (full ? 1 : amount / 2)) n.ratchet = rnd() < 0.7 ? 1 : 2 + Math.floor(rnd() * 3);
    return n;
  });
  return { ...data, steps };
}

/** Snap a note to the nearest degree of a scale rooted at `root` (pitch class). */
export function quantize(note: number, scale: number[], root = 0): number {
  const rel = note - root;
  const octave = Math.floor(rel / 12);
  const pc = rel - octave * 12;
  let best = scale[0];
  for (const deg of [...scale, 12]) if (Math.abs(deg - pc) < Math.abs(best - pc)) best = deg;
  return root + octave * 12 + best;
}

export const DIRECTIONS = ['Forward', 'Backward', 'Ping-pong', 'Random', 'Drunk'];

export interface SequencerSettings {
  length: number;
  /** Global multiplier on every step's chance. */
  density: number;
  /** Above 0.5, 'fill' steps play and '!fill' steps rest. */
  fill?: number;
  /** Index into DIRECTIONS. */
  direction?: number;
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
  /**
   * Completed passes through the pattern since the last reset, for trig
   * conditions: one pass is `length` steps, whichever way they run.
   */
  loop = 0;
  private ticks = 0;
  private pingDir = 1;
  private prevPlayed = false;
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
    this.loop = 0;
    this.ticks = 0;
    this.pingDir = 1;
    this.prevPlayed = false;
  }

  /** Advance one step on a clock pulse and return the notes to play. */
  clock(time: number, clockLength?: number): GateEvent[] {
    if (this.lastClock !== null && time > this.lastClock) this.interval = time - this.lastClock;
    else if (clockLength) this.interval = clockLength * 2;
    this.lastClock = time;

    const len = Math.max(1, Math.min(MAX_STEPS, Math.round(this.settings.length)));
    this.position = this.nextPosition(len);
    this.loop = Math.floor(this.ticks / len);
    this.ticks++;
    this.history.push({ time, step: this.position });
    if (this.history.length > 16) this.history.shift();
    const step = this.data.steps[this.position];
    if (!step?.on) return [];
    const fill = (this.settings.fill ?? 0) > 0.5;
    const plays =
      conditionPasses(step.cond, this.loop, this.prevPlayed, fill) && this.random() < step.chance * this.settings.density;
    this.prevPlayed = plays;
    if (!plays) return [];

    const note = this.pickNote(step.note);
    const slice = this.interval / step.ratchet;
    const events: GateEvent[] = [];
    for (let r = 0; r < step.ratchet; r++) {
      events.push({
        time: time + r * slice,
        value: step.velocity * (r === 0 ? 1 : 0.85),
        length: Math.max(0.005, slice * step.length),
        note,
        index: step.send || undefined,
        params: Object.keys(step.plocks).length ? step.plocks : undefined,
      });
    }
    return events;
  }

  private nextPosition(len: number): number {
    const pos = this.position;
    const fresh = pos < 0 || pos >= len;
    switch (Math.round(this.settings.direction ?? 0)) {
      case 1: // backward
        return fresh ? len - 1 : (pos - 1 + len) % len;
      case 2: {
        // ping-pong: 0 1 2 3 2 1 0 1 …, ends played once per turn
        if (fresh || len === 1) {
          this.pingDir = 1;
          return 0;
        }
        let next = pos + this.pingDir;
        if (next >= len || next < 0) {
          this.pingDir = -this.pingDir;
          next = pos + this.pingDir;
        }
        return next;
      }
      case 3: // random
        return Math.min(len - 1, Math.floor(this.random() * len));
      case 4: // drunk: one step either way
        return fresh ? 0 : (pos + (this.random() < 0.5 ? -1 : 1) + len) % len;
      default:
        return fresh ? 0 : (pos + 1) % len;
    }
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
      { id: 'fill', label: 'Fill', min: 0, max: 1, default: 0, step: 1, options: ['Off', 'On'] },
      { id: 'direction', label: 'Play', min: 0, max: DIRECTIONS.length - 1, default: 0, step: 1, options: DIRECTIONS },
    ],
    face: ['density', 'pitchRandom'],
    data: sequencerData as ModuleDataDef,
    presetScope: 'patch',
    presets: true,
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
