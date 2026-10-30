import { GateOutput } from '../engine/gate';
import { levelTap } from '../engine/modulation';
import type { ParamDef } from '../patch/types';
import { smoothSet, type ModuleType } from './types';

/** Level in decibels, floored so silence doesn't come out as -Infinity. */
export function toDb(x: number, floor = -96): number {
  return x > 0 ? Math.max(floor, 20 * Math.log10(x)) : floor;
}

/** Log-spaced frequencies for drawing a filter's response. */
export const RESPONSE_FREQS = Float32Array.from({ length: 96 }, (_, i) => 20 * Math.pow(1000, i / 95));

/** The combined response of filters in series, in dB at RESPONSE_FREQS. */
function responseDb(filters: BiquadFilterNode[]): Float32Array<ArrayBuffer> {
  const mag = new Float32Array(RESPONSE_FREQS.length).fill(1);
  const m = new Float32Array(RESPONSE_FREQS.length);
  const ph = new Float32Array(RESPONSE_FREQS.length);
  for (const f of filters) {
    f.getFrequencyResponse(RESPONSE_FREQS, m, ph);
    for (let i = 0; i < m.length; i++) mag[i] *= m[i];
  }
  return mag.map((x) => toDb(x, -60));
}

/**
 * Keeps a response curve until the filters' settings change, so the card only
 * redraws (and the browser only recomputes) when something moved.
 */
function curveCache(filters: BiquadFilterNode[]) {
  let key = '';
  let curve: Float32Array<ArrayBuffer> = new Float32Array(0);
  return () => {
    const k = filters.map((f) => `${f.type}:${f.frequency.value.toFixed(1)}:${f.Q.value.toFixed(3)}:${f.gain.value.toFixed(2)}`).join('|');
    if (k !== key) {
      key = k;
      curve = responseDb(filters);
    }
    return curve;
  };
}

/** Level meter: patch any audio through it (or just into it) to watch its level. */
export const meter: ModuleType = {
  def: {
    type: 'meter',
    label: 'Meter',
    category: 'Utility',
    visual: true,
    description: 'Shows the level of whatever goes into it, with peak hold and a clip light. Audio passes straight through.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [{ id: 'out', label: 'Thru', kind: 'audio' }],
    params: [],
  },
  create({ ctx }) {
    const thru = ctx.createGain();
    const tap = levelTap(ctx, thru);
    return {
      inputs: { in: { kind: 'node', node: thru } },
      outputs: { out: { kind: 'node', node: thru } },
      setParam() {},
      getState: () => tap.read(),
      dispose() {
        tap.dispose();
        thru.disconnect();
      },
    };
  },
};

export const LIGHT_COLORS = ['Green', 'Yellow', 'Red', 'Blue', 'White'];

/**
 * A lamp that lights while notes or gates come in, or with the level of a
 * signal. Both pass through, so it can sit inline between two modules.
 */
export const light: ModuleType = {
  def: {
    type: 'light',
    label: 'Light',
    category: 'Utility',
    visual: true,
    description: 'Lights up when a gate or note arrives, or glows with the level of a signal. Put it inline to see what a module is sending.',
    inputs: [
      { id: 'gate', label: 'Gate', kind: 'gate' },
      { id: 'in', label: 'Signal', kind: 'audio' },
    ],
    outputs: [
      { id: 'gateOut', label: 'Gate', kind: 'gate' },
      { id: 'out', label: 'Signal', kind: 'audio' },
    ],
    params: [{ id: 'color', label: 'Colour', min: 0, max: LIGHT_COLORS.length - 1, default: 0, step: 1, options: LIGHT_COLORS }],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const gateOut = new GateOutput();
    const thru = ctx.createGain();
    const tap = levelTap(ctx, thru);
    // Gates arrive ahead of time, so keep a few and light up when the audio clock reaches them.
    const gates: { time: number; end: number; value: number }[] = [];
    return {
      inputs: {
        gate: {
          kind: 'gate',
          handler: (e) => {
            gates.push({ time: e.time, end: e.time + Math.max(0.06, e.length), value: e.value });
            if (gates.length > 32) gates.shift();
            gateOut.emit(e);
          },
        },
        in: { kind: 'node', node: thru },
      },
      outputs: { gateOut: { kind: 'gate', out: gateOut }, out: { kind: 'node', node: thru } },
      setParam(id, v) {
        p[id] = v;
      },
      getState(now) {
        let on = 0;
        for (const g of gates) if (g.time <= now && now < g.end) on = Math.max(on, 0.4 + 0.6 * g.value);
        const { peak } = tap.read();
        return { level: Math.max(on, Math.min(1, peak * 1.5)), color: Math.round(p.color) };
      },
      dispose() {
        tap.dispose();
        thru.disconnect();
      },
    };
  },
};

export const MIXER_CHANNELS = 6;

const channelParams = (n: number): ParamDef[] => [
  { id: `level${n}`, label: `Level ${n}`, min: 0, max: 1, default: 0.8, step: 0.01 },
  { id: `pan${n}`, label: `Pan ${n}`, min: -1, max: 1, default: 0, step: 0.01 },
  { id: `mute${n}`, label: `Mute ${n}`, min: 0, max: 1, default: 0, step: 1, options: ['Playing', 'Muted'] },
  { id: `solo${n}`, label: `Solo ${n}`, min: 0, max: 1, default: 0, step: 1, options: ['Off', 'Solo'] },
];

/**
 * Whether a channel is heard: not muted, and either nothing is soloed or it
 * is. Solo wins over mute, as on a desk, so a soloed channel always plays.
 */
export function channelOn(p: Record<string, number>, n: number): boolean {
  const solo = (i: number) => (p[`solo${i}`] ?? 0) >= 0.5;
  if (CH.some(solo)) return solo(n);
  return (p[`mute${n}`] ?? 0) < 0.5;
}

const CH = Array.from({ length: MIXER_CHANNELS }, (_, i) => i + 1);

/** Six channels with level, pan, mute and solo into a stereo pair, with a meter per channel. */
export const mixer: ModuleType = {
  def: {
    type: 'mixer',
    label: 'Mixer',
    category: 'Utility',
    visual: true,
    description: 'Six channels with level, pan, mute and solo, summed to a stereo pair. Each channel has its own meter, and M and S buttons on the card.',
    inputs: CH.map((n) => ({ id: `in${n}`, label: `${n}`, kind: 'audio' as const })),
    outputs: [
      { id: 'left', label: 'L', kind: 'audio' },
      { id: 'right', label: 'R', kind: 'audio' },
    ],
    params: [...CH.flatMap(channelParams), { id: 'master', label: 'Master', min: 0, max: 1, default: 0.8, step: 0.01 }],
    face: [...CH.map((n) => `level${n}`), 'master'],
    groups: [{ label: 'Master', params: ['master'] }, ...CH.map((n) => ({ label: `Channel ${n}`, params: channelParams(n).map((p) => p.id) }))],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const master = ctx.createGain();
    master.channelCount = 2;
    master.channelCountMode = 'explicit';
    master.gain.value = p.master;
    const split = ctx.createChannelSplitter(2);
    master.connect(split);
    const channels = CH.map((n) => {
      const input = ctx.createGain();
      const fader = ctx.createGain();
      const pan = ctx.createStereoPanner();
      input.connect(fader).connect(pan).connect(master);
      const gain = () => (channelOn(p, n) ? p[`level${n}`] : 0);
      fader.gain.value = gain();
      pan.pan.value = p[`pan${n}`];
      return { input, fader, pan, gain, tap: levelTap(ctx, fader) };
    });
    const masterTaps = [levelTap(ctx, split, 0), levelTap(ctx, split, 1)];
    return {
      inputs: Object.fromEntries(channels.map((c, i) => [`in${i + 1}`, { kind: 'node' as const, node: c.input }])),
      outputs: { left: { kind: 'node', node: split, index: 0 }, right: { kind: 'node', node: split, index: 1 } },
      setParam(id, v) {
        p[id] = v;
        if (id === 'master') return smoothSet(master.gain, v, ctx);
        const n = Number(id.replace(/\D/g, ''));
        const c = channels[n - 1];
        if (!c) return;
        if (id.startsWith('pan')) smoothSet(c.pan.pan, v, ctx);
        // A solo changes what every other channel does.
        else if (id.startsWith('solo')) for (const x of channels) smoothSet(x.fader.gain, x.gain(), ctx);
        else smoothSet(c.fader.gain, c.gain(), ctx);
      },
      getState: () => ({
        channels: channels.map((c, i) => ({ ...c.tap.read(), muted: !channelOn(p, i + 1) })),
        master: masterTaps.map((t) => t.read()),
      }),
      dispose() {
        for (const c of channels) {
          c.tap.dispose();
          c.input.disconnect();
          c.pan.disconnect();
        }
        for (const t of masterTaps) t.dispose();
        master.disconnect();
        split.disconnect();
      },
    };
  },
};

export const FILTER_TYPES = ['Low pass', 'High pass', 'Band pass', 'Notch'];
const BIQUAD_TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

/** Resonant filter, 12 or 24 dB per octave. Its card draws the response as it moves. */
export const filter: ModuleType = {
  def: {
    type: 'filter',
    label: 'Filter',
    category: 'Sound',
    visual: true,
    presets: true,
    description: 'Low pass, high pass, band pass or notch, 12 or 24 dB. Patch an LFO or envelope onto Cutoff to sweep it.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'type', label: 'Type', min: 0, max: FILTER_TYPES.length - 1, default: 0, step: 1, options: FILTER_TYPES },
      { id: 'cutoff', label: 'Cutoff', min: 20, max: 18000, default: 1200, unit: 'Hz', curve: 'exp' },
      { id: 'resonance', label: 'Resonance', min: 0.5, max: 20, default: 1, curve: 'exp' },
      { id: 'slope', label: 'Slope', min: 0, max: 1, default: 0, step: 1, options: ['12 dB', '24 dB'] },
    ],
    face: ['type', 'cutoff', 'resonance'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const a = ctx.createBiquadFilter();
    const b = ctx.createBiquadFilter();
    a.connect(b);
    const apply = (smooth: boolean) => {
      const type = BIQUAD_TYPES[Math.round(p.type)] ?? 'lowpass';
      a.type = type;
      // The second stage only filters at 24 dB; at 12 dB it passes everything (an all-pass keeps the level flat).
      b.type = p.slope >= 0.5 ? type : 'allpass';
      for (const [param, v] of [[a.frequency, p.cutoff], [b.frequency, p.cutoff], [a.Q, p.resonance], [b.Q, p.slope >= 0.5 ? 0.707 : 0.0001]] as const) {
        if (smooth) smoothSet(param, v, ctx);
        else param.value = v;
      }
    };
    apply(false);
    const curve = curveCache([a, b]);
    return {
      inputs: { in: { kind: 'node', node: a } },
      outputs: { out: { kind: 'node', node: b } },
      setParam(id, v) {
        p[id] = v;
        apply(true);
      },
      getState: () => ({ curve: curve() }),
      dispose() {
        a.disconnect();
        b.disconnect();
      },
    };
  },
};

/** Three-band EQ: low shelf, a sweepable mid peak, high shelf. */
export const eq: ModuleType = {
  def: {
    type: 'eq',
    label: 'EQ',
    category: 'Sound',
    visual: true,
    presets: true,
    description: 'Three-band EQ: low shelf, sweepable mid, high shelf. Boost or cut up to 15 dB each.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'lowGain', label: 'Low', min: -15, max: 15, default: 0, step: 0.1, unit: 'dB' },
      { id: 'lowFreq', label: 'Low freq', min: 40, max: 1000, default: 150, unit: 'Hz', curve: 'exp' },
      { id: 'midGain', label: 'Mid', min: -15, max: 15, default: 0, step: 0.1, unit: 'dB' },
      { id: 'midFreq', label: 'Mid freq', min: 150, max: 8000, default: 1000, unit: 'Hz', curve: 'exp' },
      { id: 'midQ', label: 'Mid width', min: 0.3, max: 8, default: 1, curve: 'exp' },
      { id: 'highGain', label: 'High', min: -15, max: 15, default: 0, step: 0.1, unit: 'dB' },
      { id: 'highFreq', label: 'High freq', min: 1500, max: 16000, default: 6000, unit: 'Hz', curve: 'exp' },
    ],
    face: ['lowGain', 'midGain', 'highGain'],
    groups: [
      { label: 'Low', params: ['lowGain', 'lowFreq'] },
      { label: 'Mid', params: ['midGain', 'midFreq', 'midQ'] },
      { label: 'High', params: ['highGain', 'highFreq'] },
    ],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const low = ctx.createBiquadFilter();
    const mid = ctx.createBiquadFilter();
    const high = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    mid.type = 'peaking';
    high.type = 'highshelf';
    low.connect(mid).connect(high);
    const targets: Record<string, AudioParam> = {
      lowGain: low.gain,
      lowFreq: low.frequency,
      midGain: mid.gain,
      midFreq: mid.frequency,
      midQ: mid.Q,
      highGain: high.gain,
      highFreq: high.frequency,
    };
    for (const [id, param] of Object.entries(targets)) param.value = p[id];
    const curve = curveCache([low, mid, high]);
    return {
      inputs: { in: { kind: 'node', node: low } },
      outputs: { out: { kind: 'node', node: high } },
      setParam(id, v) {
        p[id] = v;
        if (targets[id]) smoothSet(targets[id], v, ctx);
      },
      getState: () => ({ curve: curve() }),
      dispose() {
        low.disconnect();
        mid.disconnect();
        high.disconnect();
      },
    };
  },
};
