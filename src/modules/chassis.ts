/**
 * Modules inspired by the Chassis manual (Lux Cache): a map-reading drum
 * generator, gate logic, CV math, painted macro lanes, an envelope follower
 * and a frequency shifter. Original implementations and pattern data; see
 * docs/chassis.md for what each one takes from its Chassis counterpart.
 */
import type { FollowerMessage, FollowerReport, MathMessage, ShifterMessage } from '../dsp/chassis.worklet';
import chassisWorkletUrl from '../dsp/chassis.worklet.ts?worker&url';
import { MATH_OPS, SHIFT_SIDES } from '../dsp/chassis';
import { EDGE_GATE_LENGTH } from '../engine/convert';
import { GateOutput, type GateEvent } from '../engine/gate';
import type { ModuleDataDef } from '../patch/types';
import { cvSource } from './util';
import type { ModuleType } from './types';

// --- Drum Map ----------------------------------------------------------------

export const DRUM_LANES = ['Kick', 'Snare', 'Hat', 'Aux'];
export const DRUM_STEPS = 32;
/** GM-ish drum notes, so a drum voice that follows notes still gets something sensible. */
const DRUM_NOTES = [36, 38, 42, 46];

/**
 * The map: a 3×3 grid of patterns. Left to right goes from straight to
 * broken, bottom to top from sparse to busy. Each lane is 32 steps of
 * intensity 0–9: Density decides how faint a step can be and still play.
 */
const NODES: string[][][] = [
  // y = 0 (sparse)
  [
    [
      '90000000500000009000000050000000',
      '00000000900000000000000090000000',
      '00500050005000500050005000500050',
      '00000000000000000000000000000300',
    ],
    [
      '90000030000090009000003000005000',
      '00000000900000300000000090000000',
      '50305030503050305030503050305030',
      '00000300000000000000030000000000',
    ],
    [
      '90000000002000009000300000000000',
      '00000000900000000000009000000000',
      '30005000300000703000500030000070',
      '00700000000000000000000000500000',
    ],
  ],
  // y = 0.5
  [
    [
      '90005000900050009000500090005000',
      '00000000900000020000000090000003',
      '50705070507050705070507050705075',
      '00000030000000000000003000000400',
    ],
    [
      '90000060003000009000006000300030',
      '00003000900000300000300090300000',
      '70357035703570357035703570357036',
      '00060000000300000006000000030000',
    ],
    [
      '90030000600009009003000060000500',
      '00000700900003000000070090000307',
      '53735373537353735373537353735379',
      '30000060000300003000006000030000',
    ],
  ],
  // y = 1 (busy)
  [
    [
      '90509050905090509050905090509059',
      '00300000930003000030000093000306',
      '97579757975797579757975797579759',
      '00050030000500300005003000050039',
    ],
    [
      '90360960036009609036096003600969',
      '03009030903030090300903090303609',
      '99579957995799579957995799579999',
      '05030603050306030503060305030609',
    ],
    [
      '96303960630396039630396063039699',
      '30609306939063063060930693906399',
      '97979797979797979797979797979799',
      '63036306303630636303630630363069',
    ],
  ],
];

/** Pattern intensity 0..1 for a lane and step at map point (x, y), blended between the four nearest patterns. */
export function mapIntensity(x: number, y: number, lane: number, step: number): number {
  const gx = Math.min(1, Math.max(0, x)) * 2;
  const gy = Math.min(1, Math.max(0, y)) * 2;
  const x0 = Math.min(1, Math.floor(gx));
  const y0 = Math.min(1, Math.floor(gy));
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (r: number, c: number) => Number(NODES[r][c][lane][step % DRUM_STEPS]) / 9;
  const top = at(y0, x0) * (1 - fx) + at(y0, x0 + 1) * fx;
  const bot = at(y0 + 1, x0) * (1 - fx) + at(y0 + 1, x0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** Whether a step of this intensity plays at this density, with `wobble` (−0.5..0.5 × chaos) added. */
export function drumHit(intensity: number, density: number, wobble = 0): boolean {
  if (density <= 0) return false;
  return intensity + wobble > 1 - density && intensity + wobble > 0.02;
}

/** A small hash, so the random wobble for a given bar seed, lane and step is repeatable. */
export function seededRandom(seed: number, lane: number, step: number): number {
  let h = (seed ^ (lane * 374761393) ^ (step * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export const FILL_EVERY = [0, 2, 4, 8, 16];
export const FILL_EVERY_LABELS = FILL_EVERY.map((n) => (n === 0 ? 'Off' : `Every ${n} bars`));

const DENSITY_DEFAULTS = [0.6, 0.5, 0.55, 0.3];
const densityId = (l: number) => `dens${l + 1}`;

/**
 * Inspired by Chassis' grille: four drum lanes read from a map of patterns.
 * X and Y pick the spot on the map (patch an LFO onto them to wander),
 * Density per lane thins or fills each part, Chaos wobbles steps in and out,
 * and Lock decides whether that wobble repeats bar to bar.
 */
export const drumMap: ModuleType = {
  def: {
    type: 'drummap',
    label: 'Drum Map',
    category: 'Sequencing',
    visual: true,
    presets: true,
    presetScope: 'patch',
    description: 'Four drum lanes read from a map of patterns. Drag the dot to move between straight and broken, sparse and busy; Density thins each lane.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
      { id: 'fill', label: 'Fill', kind: 'gate' },
    ],
    outputs: [
      { id: 'kick', label: 'Kick', kind: 'gate' },
      { id: 'snare', label: 'Snare', kind: 'gate' },
      { id: 'hat', label: 'Hat', kind: 'gate' },
      { id: 'aux', label: 'Aux', kind: 'gate' },
      { id: 'notes', label: 'Kit notes', kind: 'gate' },
    ],
    params: [
      { id: 'x', label: 'X (broken)', min: 0, max: 1, default: 0.3, step: 0.01 },
      { id: 'y', label: 'Y (busy)', min: 0, max: 1, default: 0.35, step: 0.01 },
      ...DRUM_LANES.map((name, l) => ({ id: densityId(l), label: `${name} density`, min: 0, max: 1, default: DENSITY_DEFAULTS[l], step: 0.01 })),
      { id: 'chaos', label: 'Chaos', min: 0, max: 1, default: 0.1, step: 0.01 },
      { id: 'lock', label: 'Lock', min: 0, max: 1, default: 0.75, step: 0.01 },
      { id: 'fillEvery', label: 'Fill', min: 0, max: FILL_EVERY.length - 1, default: 2, step: 1, options: FILL_EVERY_LABELS },
      { id: 'fillAmount', label: 'Fill amount', min: 0, max: 1, default: 0.5, step: 0.01 },
      { id: 'swing', label: 'Swing', min: 0, max: 0.75, default: 0, step: 0.01 },
    ],
    face: [],
    groups: [
      { label: 'Map', params: ['x', 'y'] },
      { label: 'Density', params: DRUM_LANES.map((_, l) => densityId(l)) },
      { label: 'Variation', params: ['chaos', 'lock', 'fillEvery', 'fillAmount', 'swing'] },
    ],
  },
  create(_env, params) {
    const p = { ...params };
    const outs = DRUM_LANES.map(() => new GateOutput());
    const notes = new GateOutput();
    let step = -1;
    let bar = 0;
    let seed = (Math.random() * 2 ** 32) >>> 0;
    let fillUntil = -1;
    const history: { time: number; step: number; hits: number[] }[] = [];
    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) => {
            step = (step + 1) % DRUM_STEPS;
            if (step === 0) {
              bar++;
              // Lock: the chance the bar keeps last bar's dice.
              if (Math.random() >= p.lock) seed = (Math.random() * 2 ** 32) >>> 0;
            }
            const every = FILL_EVERY[Math.round(p.fillEvery)] ?? 0;
            const autoFill = every > 0 && bar % every === every - 1 && step >= DRUM_STEPS - 8;
            const filling = autoFill || step <= fillUntil;
            const boost = filling ? p.fillAmount : 0;
            const chaos = Math.min(1, p.chaos + boost * 0.5);
            const time = step % 2 === 1 ? e.time + p.swing * e.length : e.time;
            const hits: number[] = [];
            DRUM_LANES.forEach((_, l) => {
              const intensity = mapIntensity(p.x, p.y, l, step);
              const wobble = (seededRandom(seed, l, step) - 0.5) * chaos;
              // Fills raise snare and hat most, the kick a little.
              const density = Math.min(1, p[densityId(l)] + boost * (l === 0 ? 0.2 : 0.6));
              if (!drumHit(intensity, density, wobble)) return;
              const ev: GateEvent = { time, length: e.length, value: Math.min(1, 0.45 + 0.55 * intensity) };
              outs[l].emit(ev);
              notes.emit({ ...ev, note: DRUM_NOTES[l], index: l + 1 });
              hits.push(l);
            });
            history.push({ time, step, hits });
            if (history.length > 8) history.shift();
          },
        },
        reset: {
          kind: 'gate',
          handler: () => {
            step = -1;
            bar = 0;
          },
        },
        fill: {
          kind: 'gate',
          // A fill gate fills the next eight steps.
          handler: () => {
            fillUntil = step + 8;
          },
        },
      },
      outputs: {
        kick: { kind: 'gate', out: outs[0] },
        snare: { kind: 'gate', out: outs[1] },
        hat: { kind: 'gate', out: outs[2] },
        aux: { kind: 'gate', out: outs[3] },
        notes: { kind: 'gate', out: notes },
      },
      setParam(id, v) {
        p[id] = v;
      },
      getState(now) {
        let h = { step: -1, hits: [] as number[], time: -1 };
        for (const x of history) if (x.time <= now) h = x;
        return { step: h.step, hits: now - h.time < 0.12 ? h.hits : [], x: p.x, y: p.y, dens: DRUM_LANES.map((_, l) => p[densityId(l)]) };
      },
      dispose() {},
    };
  },
};

// --- Logic -------------------------------------------------------------------

export const LOGIC_OPS = ['AND', 'OR', 'XOR', 'A not B', 'Toggle', 'Divide'];
/** Events this close together count as the same moment. */
const SAME_TIME = 0.002;

type Interval = { time: number; end: number; value: number; length: number };

const highAt = (list: Interval[], t: number) => list.some((x) => x.time <= t + SAME_TIME && t < x.end);

/** The combined gate for AND/OR/XOR/A-not-B. */
export function logicValue(op: number, a: boolean, b: boolean): boolean {
  switch (Math.round(op)) {
    case 0:
      return a && b;
    case 1:
      return a || b;
    case 2:
      return a !== b;
    case 3:
      return a && !b;
    default:
      return false;
  }
}

/**
 * Inspired by Chassis' atelier operators, for gates: combine two rhythms.
 * AND/OR/XOR/A-not-B look at whether each input is high at the moment a
 * gate arrives. Toggle flips on each A and lets every other one through;
 * Divide passes every Nth A. B resets the count for those two. Gates that
 * don't make it go out Else.
 */
export const logic: ModuleType = {
  def: {
    type: 'logic',
    label: 'Logic',
    category: 'Utility',
    description: 'Combines two gate rhythms: AND, OR, XOR, A not B, Toggle and Divide. What does not pass goes out Else.',
    inputs: [
      { id: 'a', label: 'A', kind: 'gate' },
      { id: 'b', label: 'B', kind: 'gate' },
    ],
    outputs: [
      { id: 'out', label: 'Out', kind: 'gate' },
      { id: 'else', label: 'Else', kind: 'gate' },
    ],
    params: [
      { id: 'op', label: 'Operator', min: 0, max: LOGIC_OPS.length - 1, default: 0, step: 1, options: LOGIC_OPS },
      { id: 'divide', label: 'Divide by', min: 2, max: 16, default: 3, step: 1 },
    ],
    face: ['op', 'divide'],
  },
  create(_env, params) {
    const p = { ...params };
    const out = new GateOutput();
    const other = new GateOutput();
    const ins: Record<'a' | 'b', Interval[]> = { a: [], b: [] };
    let pending: { side: 'a' | 'b'; e: GateEvent }[] = [];
    let outEnd = -Infinity;
    let count = 0;
    let toggled = false;

    // Gates for the same moment can arrive from two sources one after the other; decide once both are in.
    const flush = () => {
      const batch = pending.sort((x, y) => x.e.time - y.e.time);
      pending = [];
      for (const { e } of batch) {
        if (logicValue(p.op, highAt(ins.a, e.time), highAt(ins.b, e.time))) {
          // Already high (an OR whose other input is still held, or the same moment twice): no new gate.
          if (e.time < outEnd - SAME_TIME) continue;
          out.emit(e);
          outEnd = e.time + Math.max(SAME_TIME * 2, e.length);
        } else other.emit(e);
      }
    };

    const handle = (side: 'a' | 'b') => (e: GateEvent) => {
      const op = Math.round(p.op);
      if (op >= 4) {
        if (side === 'b') {
          count = 0;
          toggled = false;
          return;
        }
        if (op === 4) {
          toggled = !toggled;
          (toggled ? out : other).emit(e);
        } else {
          const pass = count % Math.max(1, Math.round(p.divide)) === 0;
          count++;
          (pass ? out : other).emit(e);
        }
        return;
      }
      const list = ins[side];
      list.push({ time: e.time, end: e.time + Math.max(0.001, e.length), value: e.value, length: e.length });
      if (list.length > 16) list.shift();
      if (!pending.length) queueMicrotask(flush);
      pending.push({ side, e });
    };

    return {
      inputs: { a: { kind: 'gate', handler: handle('a') }, b: { kind: 'gate', handler: handle('b') } },
      outputs: { out: { kind: 'gate', out }, else: { kind: 'gate', out: other } },
      setParam(id, v) {
        p[id] = v;
      },
      dispose() {},
    };
  },
};

// --- Math --------------------------------------------------------------------

/** Inspired by Chassis' atelier operators, for CV and audio: two inputs, one operator, one output. */
export const math: ModuleType = {
  worklets: [chassisWorkletUrl],
  def: {
    type: 'math',
    label: 'Math',
    category: 'Modulation',
    description: 'Two signals in, one out: add, subtract, multiply, min, max, compare, rectify, fold, slew or step. Each input has its own gain (negative inverts).',
    inputs: [
      { id: 'a', label: 'A', kind: 'cv' },
      { id: 'b', label: 'B', kind: 'cv' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'cv' }],
    params: [
      { id: 'op', label: 'Operator', min: 0, max: MATH_OPS.length - 1, default: 0, step: 1, options: MATH_OPS },
      { id: 'gainA', label: 'Gain A', min: -2, max: 2, default: 1, step: 0.01 },
      { id: 'gainB', label: 'Gain B', min: -2, max: 2, default: 1, step: 0.01 },
      { id: 'offset', label: 'Offset', min: -1, max: 1, default: 0, step: 0.01 },
      { id: 'amount', label: 'Amount', min: 0, max: 1, default: 0.2, step: 0.01 },
    ],
    face: ['op', 'gainA', 'gainB', 'offset'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const node = new AudioWorkletNode(ctx, 'mb-math', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
    const send = (msg: MathMessage) => node.port.postMessage(msg);
    const settings = () => ({ op: Math.round(p.op), gainA: p.gainA, gainB: p.gainB, offset: p.offset, amount: p.amount });
    send({ type: 'settings', settings: settings() });
    return {
      inputs: { a: { kind: 'node', node, index: 0 }, b: { kind: 'node', node, index: 1 } },
      outputs: { out: { kind: 'node', node } },
      setParam(id, v) {
        p[id] = v;
        send({ type: 'settings', settings: settings() });
      },
      dispose() {
        send({ type: 'dispose' });
        node.disconnect();
      },
    };
  },
};

// --- Lanes -------------------------------------------------------------------

export const LANE_COUNT = 4;
export const LANE_STEPS = 32;
export const LANE_RATES = ['×2', '×1', '÷2', '÷4', '÷8'];
const LANE_DIV = [0.5, 1, 2, 4, 8];

export interface LanesData {
  /** values[lane][step], 0..1, as painted. */
  values: number[][];
}

function defaultLanes(): number[][] {
  return [
    Array.from({ length: LANE_STEPS }, (_, i) => i / (LANE_STEPS - 1)),
    Array.from({ length: LANE_STEPS }, (_, i) => 1 - Math.abs((i / (LANE_STEPS / 2)) % 2 - 1)),
    Array.from({ length: LANE_STEPS }, (_, i) => 0.5 + 0.45 * Math.sin((i / LANE_STEPS) * Math.PI * 6) * Math.cos(i * 0.7)),
    Array.from({ length: LANE_STEPS }, (_, i) => (Math.floor(i / 4) % 2 ? 0.85 : 0.15)),
  ];
}

export const lanesData: ModuleDataDef<LanesData> = {
  create: () => ({ values: defaultLanes() }),
  normalize(raw) {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<LanesData>;
    const d = defaultLanes();
    if (!Array.isArray(r.values)) return { values: d };
    return {
      values: d.map((lane, l) =>
        lane.map((dv, s) => {
          const v = Array.isArray(r.values![l]) ? r.values![l][s] : dv;
          return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dv;
        }),
      ),
    };
  },
};

/** Paint one lane's step: returns new data, leaving the original untouched. */
export function paintLane(d: LanesData, lane: number, step: number, value: number): LanesData {
  return { values: d.values.map((row, l) => (l === lane ? row.map((v, s) => (s === step ? Math.min(1, Math.max(0, value)) : v)) : row)) };
}

const laneLen = (l: number) => `len${l + 1}`;
const LANE_LEN_DEFAULTS = [16, 12, 32, 7];

/**
 * Inspired by Chassis' quatre: four macro lanes you paint with a finger.
 * Each lane has its own length, so they drift against each other; a clock
 * moves the playheads and each lane sends its value out as CV, stepped or
 * gliding. Drag an output onto any setting to move it.
 */
export const lanes: ModuleType = {
  def: {
    type: 'lanes',
    label: 'Lanes',
    category: 'Modulation',
    visual: true,
    presets: true,
    presetScope: 'patch',
    description: 'Four lanes you paint with a finger. A clock moves through each at its own length, and each lane sends its value out as CV.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: Array.from({ length: LANE_COUNT }, (_, l) => ({ id: `out${l + 1}`, label: `Lane ${l + 1}`, kind: 'cv' as const })),
    params: [
      ...Array.from({ length: LANE_COUNT }, (_, l) => ({ id: laneLen(l), label: `Lane ${l + 1} length`, min: 1, max: LANE_STEPS, default: LANE_LEN_DEFAULTS[l], step: 1 })),
      { id: 'rate', label: 'Rate', min: 0, max: LANE_RATES.length - 1, default: 1, step: 1, options: LANE_RATES },
      { id: 'smooth', label: 'Glide', min: 0, max: 1, default: 0.3, step: 0.01 },
    ],
    face: [],
    data: lanesData as ModuleDataDef,
  },
  create({ ctx }, params, data) {
    const p = { ...params };
    let d = lanesData.normalize(data);
    const cvs = Array.from({ length: LANE_COUNT }, () => cvSource(ctx));
    const pos = Array(LANE_COUNT).fill(-1);
    let ticks = -1;
    let lastTick = -1;
    let period = 0.125;
    const history: { time: number; pos: number[] }[] = [];

    const advance = (time: number, stepTime: number) => {
      for (let l = 0; l < LANE_COUNT; l++) {
        const len = Math.max(1, Math.round(p[laneLen(l)]));
        pos[l] = (pos[l] + 1) % len;
        const v = d.values[l][pos[l]];
        const o = cvs[l].node.offset;
        const t = Math.max(time, ctx.currentTime);
        if (p.smooth > 0.001) {
          o.cancelScheduledValues(t);
          o.setTargetAtTime(v, t, Math.max(0.001, (stepTime * p.smooth) / 3));
        } else cvs[l].set(v, t);
      }
      history.push({ time, pos: pos.slice() });
      if (history.length > 8) history.shift();
    };

    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) => {
            if (lastTick >= 0 && e.time > lastTick) period = e.time - lastTick;
            lastTick = e.time;
            ticks++;
            const div = LANE_DIV[Math.round(p.rate)] ?? 1;
            if (div < 1) {
              advance(e.time, period / 2);
              advance(e.time + period / 2, period / 2);
            } else if (ticks % div === 0) advance(e.time, period * div);
          },
        },
        reset: {
          kind: 'gate',
          handler: () => {
            ticks = -1;
            pos.fill(-1);
          },
        },
      },
      outputs: Object.fromEntries(cvs.map((c, l) => [`out${l + 1}`, { kind: 'node' as const, node: c.node }])),
      setParam(id, v) {
        p[id] = v;
      },
      setData(next) {
        d = lanesData.normalize(next);
      },
      getState(now) {
        let h = pos.map(() => -1);
        for (const x of history) if (x.time <= now) h = x.pos;
        return { pos: h, lens: Array.from({ length: LANE_COUNT }, (_, l) => Math.round(p[laneLen(l)])) };
      },
      dispose() {
        for (const c of cvs) c.dispose();
      },
    };
  },
};

// --- Follower ----------------------------------------------------------------

/** Edges reach the main thread just after they happen; play their gates this much later. */
const FOLLOW_LATENCY = 0.01;

/**
 * Inspired by Chassis' sillage: follows how loud a sound is. The level comes
 * out as CV, and a gate fires each time it rises past the threshold, so a
 * drum loop can duck a pad, open a filter, or trigger another voice.
 */
export const follower: ModuleType = {
  worklets: [chassisWorkletUrl],
  def: {
    type: 'follower',
    label: 'Follower',
    category: 'Modulation',
    visual: true,
    description: 'Follows how loud a sound is. Level comes out as CV; Gate fires when it rises past the threshold. Audio passes through.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [
      { id: 'env', label: 'Level', kind: 'cv' },
      { id: 'gate', label: 'Gate', kind: 'gate' },
      { id: 'thru', label: 'Thru', kind: 'audio' },
    ],
    params: [
      { id: 'attack', label: 'Attack', min: 0.0005, max: 1, default: 0.005, unit: 's', curve: 'exp' },
      { id: 'release', label: 'Release', min: 0.005, max: 4, default: 0.15, unit: 's', curve: 'exp' },
      { id: 'gain', label: 'Gain', min: 0.1, max: 10, default: 2, curve: 'exp' },
      { id: 'threshold', label: 'Threshold', min: 0.01, max: 1, default: 0.3, step: 0.01 },
    ],
    face: ['gain', 'threshold'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const thru = ctx.createGain();
    const node = new AudioWorkletNode(ctx, 'mb-follower', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    thru.connect(node);
    const send = (msg: FollowerMessage) => node.port.postMessage(msg);
    const settings = () => ({ attack: p.attack, release: p.release, gain: p.gain, threshold: p.threshold });
    send({ type: 'settings', settings: settings() });
    const gate = new GateOutput();
    let level = 0;
    let open = false;
    node.port.onmessage = (e: MessageEvent<FollowerReport>) => {
      level = e.data.level;
      for (const edge of e.data.edges) {
        open = edge.rising;
        if (edge.rising) gate.emit({ time: Math.max(edge.time, ctx.currentTime) + FOLLOW_LATENCY, value: Math.min(1, level), length: EDGE_GATE_LENGTH });
      }
    };
    return {
      inputs: { in: { kind: 'node', node: thru } },
      outputs: { env: { kind: 'node', node }, gate: { kind: 'gate', out: gate }, thru: { kind: 'node', node: thru } },
      setParam(id, v) {
        p[id] = v;
        send({ type: 'settings', settings: settings() });
      },
      getState: () => ({ level, open, threshold: p.threshold }),
      dispose() {
        send({ type: 'dispose' });
        node.port.onmessage = null;
        node.disconnect();
        thru.disconnect();
      },
    };
  },
};

// --- Frequency shifter -------------------------------------------------------

/**
 * Inspired by Chassis' biais: moves every frequency by the same number of
 * hertz. Small shifts make slow barber-pole phasing; large ones turn
 * harmonic sounds into bells and metal. Feedback spirals the shift.
 */
export const shifter: ModuleType = {
  worklets: [chassisWorkletUrl],
  def: {
    type: 'shifter',
    label: 'Freq Shifter',
    category: 'Effects',
    presets: true,
    description: 'Moves every frequency by the same number of hertz. A few Hz phases and swirls; hundreds turn notes into bells and metal.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'shift', label: 'Shift', min: -1000, max: 1000, default: 30, step: 1, unit: 'Hz' },
      { id: 'fine', label: 'Fine', min: -10, max: 10, default: 0, step: 0.01, unit: 'Hz' },
      { id: 'side', label: 'Direction', min: 0, max: SHIFT_SIDES.length - 1, default: 0, step: 1, options: SHIFT_SIDES },
      { id: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0, step: 0.01 },
      { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, step: 0.01 },
    ],
    face: ['shift', 'feedback', 'mix'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const node = new AudioWorkletNode(ctx, 'mb-shifter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const send = (msg: ShifterMessage) => node.port.postMessage(msg);
    const settings = () => ({ shift: p.shift + p.fine, side: Math.round(p.side), feedback: p.feedback, mix: p.mix });
    send({ type: 'settings', settings: settings() });
    return {
      inputs: { in: { kind: 'node', node } },
      outputs: { out: { kind: 'node', node } },
      setParam(id, v) {
        p[id] = v;
        send({ type: 'settings', settings: settings() });
      },
      dispose() {
        send({ type: 'dispose' });
        node.disconnect();
      },
    };
  },
};

