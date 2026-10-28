import { GateOutput } from '../engine/gate';
import { smoothSet, type ModuleType } from './types';

/** Sends audio to the speakers. */
export const output: ModuleType = {
  def: {
    type: 'output',
    label: 'Output',
    inputs: [
      { id: 'left', label: 'L', kind: 'audio' },
      { id: 'right', label: 'R', kind: 'audio' },
    ],
    outputs: [],
    params: [{ id: 'level', label: 'Level', min: 0, max: 1, default: 0.7, step: 0.01 }],
  },
  create({ ctx, master }, params) {
    const merger = ctx.createChannelMerger(2);
    const left = ctx.createGain();
    const right = ctx.createGain();
    const level = ctx.createGain();
    level.gain.value = params.level;
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(level).connect(master);
    return {
      inputs: { left: { kind: 'node', node: left }, right: { kind: 'node', node: right } },
      outputs: {},
      setParam(id, v) {
        if (id === 'level') smoothSet(level.gain, v, ctx);
      },
      dispose() {
        level.disconnect();
      },
    };
  },
};

const WAVES: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];

/** Basic oscillator with a linear FM input. Mainly a test source until the FM voice lands. */
export const oscillator: ModuleType = {
  def: {
    type: 'oscillator',
    label: 'Oscillator',
    inputs: [{ id: 'fm', label: 'FM', kind: 'cv' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'freq', label: 'Freq', min: 20, max: 8000, default: 220, unit: 'Hz', curve: 'exp' },
      { id: 'wave', label: 'Wave', min: 0, max: 3, default: 0, step: 1, options: ['Sine', 'Triangle', 'Saw', 'Square'] },
      { id: 'fmDepth', label: 'FM depth', min: 0, max: 4000, default: 0, unit: 'Hz', curve: 'exp' },
    ],
  },
  create({ ctx }, params) {
    const osc = ctx.createOscillator();
    osc.type = WAVES[params.wave] ?? 'sine';
    osc.frequency.value = params.freq;
    const fm = ctx.createGain();
    fm.gain.value = params.fmDepth;
    fm.connect(osc.frequency);
    osc.start();
    return {
      inputs: { fm: { kind: 'node', node: fm } },
      outputs: { out: { kind: 'node', node: osc } },
      setParam(id, v) {
        if (id === 'freq') smoothSet(osc.frequency, v, ctx);
        else if (id === 'wave') osc.type = WAVES[Math.round(v)] ?? 'sine';
        else if (id === 'fmDepth') smoothSet(fm.gain, v, ctx);
      },
      dispose() {
        osc.stop();
        osc.disconnect();
        fm.disconnect();
      },
    };
  },
};

/** Amplifier: gain = level + CV. Patch an envelope into CV to shape notes. */
export const vca: ModuleType = {
  def: {
    type: 'vca',
    label: 'VCA',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio' },
      { id: 'cv', label: 'CV', kind: 'cv' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [{ id: 'level', label: 'Level', min: 0, max: 1, default: 0, step: 0.01 }],
  },
  create({ ctx }, params) {
    const amp = ctx.createGain();
    amp.gain.value = params.level;
    return {
      inputs: { in: { kind: 'node', node: amp }, cv: { kind: 'param', param: amp.gain } },
      outputs: { out: { kind: 'node', node: amp } },
      setParam(id, v) {
        if (id === 'level') smoothSet(amp.gain, v, ctx);
      },
      dispose() {
        amp.disconnect();
      },
    };
  },
};

/** Attack/decay envelope fired by a gate. Outputs 0..1 scaled by velocity. */
export const envelope: ModuleType = {
  def: {
    type: 'envelope',
    label: 'Envelope',
    inputs: [{ id: 'gate', label: 'Gate', kind: 'gate' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'cv' }],
    params: [
      { id: 'attack', label: 'Attack', min: 0.001, max: 2, default: 0.003, unit: 's', curve: 'exp' },
      { id: 'decay', label: 'Decay', min: 0.005, max: 4, default: 0.18, unit: 's', curve: 'exp' },
    ],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const src = ctx.createConstantSource();
    src.offset.value = 0;
    src.start();
    return {
      inputs: {
        gate: {
          kind: 'gate',
          handler: ({ time, value }) => {
            const o = src.offset;
            o.cancelScheduledValues(time);
            // Time constants of a third of the stage length land within ~5% of the target.
            o.setTargetAtTime(value, time, p.attack / 3);
            o.setTargetAtTime(0, time + p.attack, p.decay / 3);
          },
        },
      },
      outputs: { out: { kind: 'node', node: src } },
      setParam(id, v) {
        p[id] = v;
      },
      dispose() {
        src.stop();
        src.disconnect();
      },
    };
  },
};

/** Musical divisions, in beats, for the clock's rate param. */
export const CLOCK_DIVISIONS = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8];
export const CLOCK_DIVISION_LABELS = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'];

/** Next tick times in [from, to), given the time of the next pending tick. Pure, for testing. */
export function clockTicks(next: number, from: number, to: number, interval: number): { ticks: number[]; next: number } {
  const ticks: number[] = [];
  // Catch up if we fell behind rather than emitting late ticks.
  if (next < from) next += Math.ceil((from - next) / interval) * interval;
  while (next < to) {
    ticks.push(next);
    next += interval;
  }
  return { ticks, next };
}

/** Master clock: emits gate pulses at a tempo-synced rate. */
export const clock: ModuleType = {
  def: {
    type: 'clock',
    label: 'Clock',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', kind: 'gate' }],
    params: [
      { id: 'bpm', label: 'BPM', min: 20, max: 300, default: 120, step: 0.1 },
      { id: 'division', label: 'Rate', min: 0, max: CLOCK_DIVISIONS.length - 1, default: 3, step: 1, options: CLOCK_DIVISION_LABELS },
      { id: 'running', label: 'Run', min: 0, max: 1, default: 1, step: 1, options: ['Stopped', 'Running'] },
    ],
  },
  create({ ctx, scheduler }, params) {
    const p = { ...params };
    const out = new GateOutput();
    let next = ctx.currentTime + 0.05;
    const interval = () => (60 / p.bpm) * (CLOCK_DIVISIONS[Math.round(p.division)] ?? 0.25);
    const remove = scheduler.add((from, to) => {
      if (!p.running) {
        next = to;
        return;
      }
      const step = interval();
      const r = clockTicks(next, from, to, step);
      next = r.next;
      for (const time of r.ticks) out.emit({ time, value: 1, length: step / 2 });
    });
    return {
      inputs: {},
      outputs: { out: { kind: 'gate', out } },
      setParam(id, v) {
        p[id] = v;
      },
      dispose: remove,
    };
  },
};
