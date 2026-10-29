import { GateOutput } from '../engine/gate';
import type { ModuleDataDef } from '../patch/types';
import { weightedPick } from './generative';
import { NOTE_NAMES } from './sequencer';
import { cvSource } from './util';
import type { ModuleType } from './types';

export const MARKOV_MAX = 16;
/** Weight levels a cell cycles through when tapped. */
export const MARKOV_LEVELS = [0, 25, 50, 100];

export const MARKOV_TRIGS = 8;

export interface MarkovState {
  /** MIDI note this state plays. */
  note: number;
  /** Velocity, 0..1. */
  vel: number;
  /** Note length as a fraction of a clock step. */
  len: number;
  /** Chance the state sounds when the chain lands on it, 0..1 (the chain moves on either way). */
  prob: number;
  /** Which trigger output (1–8) this state fires as well as Notes, like the Max patch's TRIG column; 0 = none. */
  trig: number;
  /** Clocks the chain stays on this state (retriggering each one) before moving on. */
  repeat: number;
  /** Rest instead of playing. */
  mute: boolean;
}

export interface MarkovData {
  /** weights[from][to], 0 = never. Rows are where the chain is, columns where it can go next. */
  weights: number[][];
  states: MarkovState[];
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];

function defaultState(i: number): MarkovState {
  return { note: 48 + MINOR[i % 7] + 12 * Math.floor(i / 7), vel: 0.85, len: 0.5, prob: 1, trig: (i % 2) + 1, repeat: 1, mute: false };
}

/** A chain that mostly walks to the next state, sometimes leaps a third or falls back home. */
function defaultWeights(): number[][] {
  return Array.from({ length: MARKOV_MAX }, (_, r) =>
    Array.from({ length: MARKOV_MAX }, (_, c) => {
      if (r >= 8 || c >= 8) return 0;
      if (c === (r + 1) % 8) return 100;
      if (c === (r + 3) % 8) return 50;
      if (c === 0 && r !== 7) return 25;
      return 0;
    }),
  );
}

const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

export const markovData: ModuleDataDef<MarkovData> = {
  create: () => ({ weights: defaultWeights(), states: Array.from({ length: MARKOV_MAX }, (_, i) => defaultState(i)) }),
  normalize(raw) {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<MarkovData>;
    const rows = Array.isArray(r.weights) ? r.weights : null;
    const states = Array.isArray(r.states) ? r.states : [];
    const fallback = defaultWeights();
    let weights = Array.from({ length: MARKOV_MAX }, (_, i) =>
      Array.from({ length: MARKOV_MAX }, (_, j) => (rows ? num(Array.isArray(rows[i]) ? rows[i][j] : 0, 0, 100, 0) : fallback[i][j])),
    );
    // The first version weighted cells 1–4; scale those up to the 0–100 range so their circles show.
    const max = Math.max(...weights.flat());
    if (max > 0 && max <= 4) weights = weights.map((row) => row.map((w) => w * 25));
    return {
      weights,
      states: Array.from({ length: MARKOV_MAX }, (_, i) => {
        const s = states[i] as Partial<MarkovState> | undefined;
        const d = defaultState(i);
        if (typeof s !== 'object' || s === null) return d;
        return {
          note: Math.round(num(s.note, 0, 127, d.note)),
          vel: num(s.vel, 0, 1, d.vel),
          len: num(s.len, 0.05, 1, d.len),
          prob: num(s.prob, 0, 1, d.prob),
          trig: Math.round(num(s.trig, 0, MARKOV_TRIGS, d.trig)),
          repeat: Math.round(num(s.repeat, 1, 8, 1)),
          mute: s.mute === true,
        };
      }),
    };
  },
};

/** Next state from `from` among the first `size` states. A row with no way out jumps anywhere. */
export function markovNext(weights: number[][], from: number, size: number, random: () => number = Math.random): number {
  const row = weights[from]?.slice(0, size) ?? [];
  return weightedPick(row.length ? row : Array(size).fill(1), random);
}

/** Fill a matrix with sparse random weights: a few ways out of each state. */
export function randomMarkov(size: number, random: () => number = Math.random): number[][] {
  return Array.from({ length: MARKOV_MAX }, (_, r) =>
    Array.from({ length: MARKOV_MAX }, (_, c) => {
      if (r >= size || c >= size) return 0;
      return random() < 2.5 / size ? MARKOV_LEVELS[1 + Math.floor(random() * 3)] : 0;
    }),
  );
}

export function stateLabel(s: MarkovState): string {
  return `${NOTE_NAMES[s.note % 12]}${Math.floor(s.note / 12) - 1}`;
}

/**
 * First-order Markov chain (the Max patch): on each clock it moves from the
 * current state to the next by the weights in that state's row, and plays the
 * new state's note. Notes also carry the state number, so it can pick presets.
 */
export const markov: ModuleType = {
  def: {
    type: 'markov',
    label: 'Markov Chain',
    visual: true,
    category: 'Generative',
    description: 'A grid of chances: each row says where the melody can go next from that note. Tap cells to set weights.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: [
      { id: 'notes', label: 'Notes', kind: 'gate' },
      { id: 'state', label: 'State', kind: 'cv' },
      ...Array.from({ length: MARKOV_TRIGS }, (_, i) => ({ id: `trig${i + 1}`, label: `Trig ${i + 1}`, kind: 'gate' as const })),
    ],
    params: [
      { id: 'size', label: 'States', min: 2, max: MARKOV_MAX, default: 8, step: 1 },
      { id: 'gate', label: 'Length ×', min: 0.25, max: 2, default: 1, step: 0.01 },
      { id: 'chance', label: 'Chance ×', min: 0, max: 1, default: 1, step: 0.01 },
      { id: 'transpose', label: 'Transpose', min: -24, max: 24, default: 0, step: 1, unit: 'st' },
    ],
    face: [],
    data: markovData as ModuleDataDef,
    presetScope: 'patch',
    presets: true,
  },
  create({ ctx }, params, data) {
    const p = { ...params };
    let d = markovData.normalize(data);
    const notes = new GateOutput();
    const trigs = Array.from({ length: MARKOV_TRIGS }, () => new GateOutput());
    const stateCv = cvSource(ctx);
    let prev = -1;
    let current = 0;
    let held = 0;
    let started = false;
    const history: { time: number; state: number; prev: number }[] = [];
    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) => {
            const size = Math.round(p.size);
            if (!started) {
              started = true;
              current = Math.min(current, size - 1);
            } else if (++held >= d.states[current].repeat) {
              prev = current;
              current = markovNext(d.weights, current, size);
              held = 0;
            }
            const s = d.states[current];
            stateCv.set(current / Math.max(1, size - 1), e.time);
            // Chance × scales every state's own chance, a top-level probability like the Max patch's.
            if (!s.mute && Math.random() < s.prob * (p.chance ?? 1)) {
              const ev = { time: e.time, value: s.vel, length: e.length * 2 * s.len * p.gate, note: s.note + Math.round(p.transpose), index: current + 1 };
              notes.emit(ev);
              if (s.trig > 0) trigs[s.trig - 1].emit(ev);
            }
            history.push({ time: e.time, state: current, prev });
            if (history.length > 8) history.shift();
          },
        },
        reset: {
          kind: 'gate',
          handler: () => {
            current = 0;
            held = 0;
            prev = -1;
            started = false;
          },
        },
      },
      outputs: {
        notes: { kind: 'gate', out: notes },
        state: { kind: 'node', node: stateCv.node },
        ...Object.fromEntries(trigs.map((out, i) => [`trig${i + 1}`, { kind: 'gate' as const, out }])),
      },
      setParam(id, v) {
        p[id] = v;
      },
      setData(next) {
        d = markovData.normalize(next);
      },
      getState(now) {
        let state = -1;
        let from = -1;
        for (const h of history) if (h.time <= now) ({ state, prev: from } = h);
        return { state, prev: from, size: Math.round(p.size), weights: d.weights };
      },
      dispose: stateCv.dispose,
    };
  },
};
