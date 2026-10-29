import { GateOutput, type GateEvent } from '../engine/gate';
import { cvSource, PITCH_PARAMS, unitToNote } from './util';
import type { ModuleType } from './types';

type Rng = () => number;

// --- Chance gate -------------------------------------------------------------

/** Bernoulli gate: each event goes to A with probability `chance`, otherwise to B. */
export function chanceRoute(chance: number, random: Rng = Math.random): 'a' | 'b' {
  return random() < chance ? 'a' : 'b';
}

export const chanceGate: ModuleType = {
  def: {
    type: 'chance',
    label: 'Chance Gate',
    category: 'Generative',
    description: 'Each gate or note goes out A with some chance, otherwise out B. Coin toss for rhythms.',
    inputs: [{ id: 'in', label: 'In', kind: 'gate' }],
    outputs: [
      { id: 'a', label: 'A', kind: 'gate' },
      { id: 'b', label: 'B', kind: 'gate' },
    ],
    params: [{ id: 'chance', label: 'Chance A', min: 0, max: 1, default: 0.5, step: 0.01 }],
    face: ['chance'],
  },
  create(_env, params) {
    const p = { ...params };
    const a = new GateOutput();
    const b = new GateOutput();
    let last = { time: -1, side: '' };
    return {
      inputs: {
        in: {
          kind: 'gate',
          handler: (e) => {
            const side = chanceRoute(p.chance);
            (side === 'a' ? a : b).emit(e);
            last = { time: e.time, side };
          },
        },
      },
      outputs: { a: { kind: 'gate', out: a }, b: { kind: 'gate', out: b } },
      setParam(id, v) {
        p[id] = v;
      },
      getState: (now) => ({ side: last.time <= now && now - last.time < 0.15 ? last.side : '' }),
      dispose() {},
    };
  },
};

// --- Weighted random ---------------------------------------------------------

export const CHOICES = 4;

/** Index picked by weight; all-zero weights pick evenly. */
export function weightedPick(weights: number[], random: Rng = Math.random): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return Math.min(weights.length - 1, Math.floor(random() * weights.length));
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export const probability: ModuleType = {
  def: {
    type: 'random',
    label: 'Probability',
    category: 'Generative',
    description: 'Each trigger picks one of four outs by weight. Notes carries the pick as a preset number (1–4), so one FM Voice becomes a random kit.',
    inputs: [{ id: 'trig', label: 'Trig', kind: 'gate' }],
    outputs: [
      ...Array.from({ length: CHOICES }, (_, i) => ({ id: `out${i + 1}`, label: `${i + 1}`, kind: 'gate' as const })),
      { id: 'notes', label: 'Notes', kind: 'gate' },
      { id: 'value', label: 'Value', kind: 'cv' },
    ],
    params: Array.from({ length: CHOICES }, (_, i) => ({ id: `w${i + 1}`, label: `Weight ${i + 1}`, min: 0, max: 1, default: [0.5, 0.25, 0.15, 0.1][i], step: 0.01 })),
    face: ['w1', 'w2', 'w3', 'w4'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const outs = Array.from({ length: CHOICES }, () => new GateOutput());
    const notes = new GateOutput();
    const value = cvSource(ctx);
    const history: { time: number; pick: number }[] = [];
    return {
      inputs: {
        trig: {
          kind: 'gate',
          handler: (e) => {
            const pick = weightedPick(outs.map((_, i) => p[`w${i + 1}`]));
            outs[pick].emit(e);
            notes.emit({ ...e, index: pick + 1 });
            value.set(pick / (CHOICES - 1), e.time);
            history.push({ time: e.time, pick });
            if (history.length > 8) history.shift();
          },
        },
      },
      outputs: {
        ...Object.fromEntries(outs.map((out, i) => [`out${i + 1}`, { kind: 'gate' as const, out }])),
        notes: { kind: 'gate', out: notes },
        value: { kind: 'node', node: value.node },
      },
      setParam(id, v) {
        p[id] = v;
      },
      getState(now) {
        let pick = -1;
        for (const h of history) if (h.time <= now) pick = h.pick;
        return { pick };
      },
      dispose: value.dispose,
    };
  },
};

// --- Euclidean ---------------------------------------------------------------

/** Whether step `i` is a hit when `hits` are spread as evenly as possible over `steps`, turned by `rotate`. */
export function euclidHit(i: number, hits: number, steps: number, rotate = 0): boolean {
  if (steps <= 0 || hits <= 0) return false;
  if (hits >= steps) return true;
  const j = (((i - rotate) % steps) + steps) % steps;
  return (j * hits) % steps < hits;
}

export const euclid: ModuleType = {
  def: {
    type: 'euclid',
    label: 'Euclidean',
    category: 'Sequencing',
    description: 'Spreads a number of hits evenly over a loop of steps. Rests go out the Off jack.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: [
      { id: 'out', label: 'Hits', kind: 'gate' },
      { id: 'off', label: 'Off', kind: 'gate' },
    ],
    params: [
      { id: 'steps', label: 'Steps', min: 1, max: 32, default: 16, step: 1 },
      { id: 'hits', label: 'Hits', min: 0, max: 32, default: 5, step: 1 },
      { id: 'rotate', label: 'Rotate', min: 0, max: 31, default: 0, step: 1 },
      { id: 'accent', label: 'Accent', min: 0, max: 1, default: 0.3, step: 0.01 },
    ],
    face: ['hits', 'steps'],
    presetScope: 'patch',
    presets: true,
  },
  create(_env, params) {
    const p = { ...params };
    const out = new GateOutput();
    const off = new GateOutput();
    let pos = -1;
    const history: { time: number; step: number }[] = [];
    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) => {
            const steps = Math.round(p.steps);
            pos = (pos + 1) % steps;
            const hit = euclidHit(pos, Math.round(p.hits), steps, Math.round(p.rotate));
            // The first hit of the loop is the downbeat; the rest are quieter by Accent.
            const first = hit && !Array.from({ length: pos }, (_, k) => euclidHit(k, Math.round(p.hits), steps, Math.round(p.rotate))).some(Boolean);
            (hit ? out : off).emit({ time: e.time, length: e.length, value: first ? 1 : 1 - p.accent });
            history.push({ time: e.time, step: pos });
            if (history.length > 8) history.shift();
          },
        },
        reset: { kind: 'gate', handler: () => (pos = -1) },
      },
      outputs: { out: { kind: 'gate', out }, off: { kind: 'gate', out: off } },
      setParam(id, v) {
        p[id] = v;
      },
      getState(now) {
        let step = -1;
        for (const h of history) if (h.time <= now) step = h.step;
        return { step };
      },
      dispose() {},
    };
  },
};

// --- Turing machine ----------------------------------------------------------

export const TURING_BITS = 16;

/**
 * One clock of a Turing machine: the register rotates by one over its first
 * `length` bits, and the bit coming round flips with probability `change`.
 * At 0 the loop repeats forever; at 1 it's always new; in between it drifts.
 */
export function turingStep(bits: boolean[], length: number, change: number, random: Rng = Math.random): boolean[] {
  const len = Math.max(1, Math.min(bits.length, Math.round(length)));
  let incoming = bits[len - 1];
  if (random() < change) incoming = !incoming;
  return [incoming, ...bits.slice(0, len - 1), ...bits.slice(len)];
}

/** The first eight bits as a number 0..1. */
export function turingValue(bits: boolean[]): number {
  let v = 0;
  for (let i = 0; i < 8; i++) v = v * 2 + (bits[i] ? 1 : 0);
  return v / 255;
}

export const turing: ModuleType = {
  def: {
    type: 'turing',
    label: 'Turing Machine',
    category: 'Sequencing',
    description: 'A looping random melody. Change at 0 locks the loop, at 1 it is always new, in between it slowly mutates.',
    inputs: [{ id: 'clock', label: 'Clock', kind: 'gate' }],
    outputs: [
      { id: 'notes', label: 'Notes', kind: 'gate' },
      { id: 'gate', label: 'Gate', kind: 'gate' },
      { id: 'cv', label: 'CV', kind: 'cv' },
    ],
    params: [
      { id: 'length', label: 'Length', min: 2, max: TURING_BITS, default: 8, step: 1 },
      { id: 'change', label: 'Change', min: 0, max: 1, default: 0.1, step: 0.01 },
      { id: 'density', label: 'Density', min: 0, max: 1, default: 1, step: 0.01 },
      { id: 'range', label: 'Range', min: 0.5, max: 3, default: 1.5, step: 0.5, unit: 'oct' },
      ...PITCH_PARAMS,
    ],
    face: ['change', 'length'],
    presetScope: 'patch',
    presets: true,
  },
  create({ ctx }, params) {
    const p = { ...params };
    const notes = new GateOutput();
    const gate = new GateOutput();
    const cv = cvSource(ctx);
    let bits = Array.from({ length: TURING_BITS }, () => Math.random() < 0.5);
    const history: { time: number; bits: boolean[] }[] = [];
    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) => {
            bits = turingStep(bits, p.length, p.change);
            const v = turingValue(bits);
            cv.set(v, e.time);
            if (bits[0]) gate.emit({ time: e.time, value: 1, length: e.length });
            // Density thins the notes using bits further down the register, so the rhythm loops too.
            const keep = turingValue(bits.slice(4).concat(bits.slice(0, 4))) < p.density;
            if (keep) notes.emit({ time: e.time, value: 0.6 + 0.4 * v, length: e.length, note: unitToNote(v, p.range, p) });
            history.push({ time: e.time, bits });
            if (history.length > 8) history.shift();
          },
        },
      },
      outputs: { notes: { kind: 'gate', out: notes }, gate: { kind: 'gate', out: gate }, cv: { kind: 'node', node: cv.node } },
      setParam(id, v) {
        p[id] = v;
      },
      getState(now) {
        let b: boolean[] = bits;
        for (const h of history) if (h.time <= now) b = h.bits;
        return { bits: b, length: Math.round(p.length) };
      },
      dispose: cv.dispose,
    };
  },
};

// --- Sample & hold / random walk ---------------------------------------------

export const SH_MODES = ['Random', 'Walk'];

/** Next held value: a fresh random value, or a step of up to ±`step` from the last, bounced off 0 and 1. */
export function nextHeld(last: number, mode: number, step: number, random: Rng = Math.random): number {
  if (Math.round(mode) === 0) return random();
  let v = last + (random() * 2 - 1) * step;
  if (v < 0) v = -v;
  if (v > 1) v = 2 - v;
  return Math.min(1, Math.max(0, v));
}

export const sampleHold: ModuleType = {
  def: {
    type: 'sh',
    label: 'Sample & Hold',
    category: 'Modulation',
    description: 'Each trigger holds a new random value, or takes a drunken step from the last one. Out as CV and as notes on a scale.',
    inputs: [{ id: 'trig', label: 'Trig', kind: 'gate' }],
    outputs: [
      { id: 'cv', label: 'CV', kind: 'cv' },
      { id: 'notes', label: 'Notes', kind: 'gate' },
    ],
    params: [
      { id: 'mode', label: 'Mode', min: 0, max: 1, default: 0, step: 1, options: SH_MODES },
      { id: 'step', label: 'Walk step', min: 0.01, max: 0.5, default: 0.1, step: 0.01 },
      { id: 'range', label: 'Range', min: 0.5, max: 3, default: 1, step: 0.5, unit: 'oct' },
      ...PITCH_PARAMS,
    ],
    face: ['mode', 'step'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const cv = cvSource(ctx);
    const notes = new GateOutput();
    let held = 0.5;
    const history: { time: number; v: number }[] = [];
    return {
      inputs: {
        trig: {
          kind: 'gate',
          handler: (e: GateEvent) => {
            held = nextHeld(held, p.mode, p.step);
            cv.set(held, e.time);
            notes.emit({ ...e, note: unitToNote(held, p.range, p) });
            history.push({ time: e.time, v: held });
            if (history.length > 8) history.shift();
          },
        },
      },
      outputs: { cv: { kind: 'node', node: cv.node }, notes: { kind: 'gate', out: notes } },
      setParam(id, v) {
        p[id] = v;
      },
      getState(now) {
        let v = -1;
        for (const h of history) if (h.time <= now) v = h.v;
        return { value: v };
      },
      dispose: cv.dispose,
    };
  },
};

