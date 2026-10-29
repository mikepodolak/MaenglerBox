import { GateOutput } from '../engine/gate';
import type { ModuleDataDef } from '../patch/types';
import { weightedPick } from './generative';
import { NOTE_NAMES } from './sequencer';
import { cvSource } from './util';
import type { ModuleType } from './types';

export const MARKOV_MAX = 16;
/** Weight levels a cell cycles through when tapped. */
export const MARKOV_LEVELS = [0, 1, 2, 4];

export interface MarkovState {
  /** MIDI note this state plays. */
  note: number;
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
  return { note: 48 + MINOR[i % 7] + 12 * Math.floor(i / 7), repeat: 1, mute: false };
}

/** A chain that mostly walks to the next state, sometimes leaps a third or falls back home. */
function defaultWeights(): number[][] {
  return Array.from({ length: MARKOV_MAX }, (_, r) =>
    Array.from({ length: MARKOV_MAX }, (_, c) => {
      if (r >= 8 || c >= 8) return 0;
      if (c === (r + 1) % 8) return 4;
      if (c === (r + 3) % 8) return 2;
      if (c === 0 && r !== 7) return 1;
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
    return {
      weights: Array.from({ length: MARKOV_MAX }, (_, i) =>
        Array.from({ length: MARKOV_MAX }, (_, j) => (rows ? num(Array.isArray(rows[i]) ? rows[i][j] : 0, 0, 100, 0) : fallback[i][j])),
      ),
      states: Array.from({ length: MARKOV_MAX }, (_, i) => {
        const s = states[i] as Partial<MarkovState> | undefined;
        const d = defaultState(i);
        if (typeof s !== 'object' || s === null) return d;
        return {
          note: Math.round(num(s.note, 0, 127, d.note)),
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
    category: 'Generative',
    description: 'A grid of chances: each row says where the melody can go next from that note. Tap cells to set weights.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: [
      { id: 'notes', label: 'Notes', kind: 'gate' },
      { id: 'state', label: 'State', kind: 'cv' },
    ],
    params: [
      { id: 'size', label: 'States', min: 2, max: MARKOV_MAX, default: 8, step: 1 },
      { id: 'gate', label: 'Gate', min: 0.05, max: 1, default: 0.5, step: 0.01 },
      { id: 'transpose', label: 'Transpose', min: -24, max: 24, default: 0, step: 1, unit: 'st' },
    ],
    face: ['size'],
    data: markovData as ModuleDataDef,
    presetScope: 'patch',
    presets: true,
  },
  create({ ctx }, params, data) {
    const p = { ...params };
    let d = markovData.normalize(data);
    const notes = new GateOutput();
    const stateCv = cvSource(ctx);
    let current = 0;
    let held = 0;
    let started = false;
    const history: { time: number; state: number }[] = [];
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
              current = markovNext(d.weights, current, size);
              held = 0;
            }
            const s = d.states[current];
            stateCv.set(current / Math.max(1, size - 1), e.time);
            if (!s.mute) {
              notes.emit({ time: e.time, value: 0.85, length: e.length * 2 * p.gate, note: s.note + Math.round(p.transpose), index: current + 1 });
            }
            history.push({ time: e.time, state: current });
            if (history.length > 8) history.shift();
          },
        },
        reset: {
          kind: 'gate',
          handler: () => {
            current = 0;
            held = 0;
            started = false;
          },
        },
      },
      outputs: { notes: { kind: 'gate', out: notes }, state: { kind: 'node', node: stateCv.node } },
      setParam(id, v) {
        p[id] = v;
      },
      setData(next) {
        d = markovData.normalize(next);
      },
      getState(now) {
        let state = -1;
        for (const h of history) if (h.time <= now) state = h.state;
        return { state };
      },
      dispose: stateCv.dispose,
    };
  },
};
