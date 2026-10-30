import type { GlitchMessage } from '../dsp/glitch.worklet';
import glitchWorkletUrl from '../dsp/glitch.worklet.ts?worker&url';
import type { ModDelayMessage } from '../dsp/moddelay.worklet';
import moddelayWorkletUrl from '../dsp/moddelay.worklet.ts?worker&url';
import { ClockFollower } from './lfo';
import { smoothSet, type ModuleType } from './types';

const MIX = { id: 'mix', label: 'Mix', min: 0, max: 1, default: 0.35, step: 0.01 };

/**
 * Dry and wet paths into one output, crossfaded at equal power so the middle
 * of the Mix knob isn't quieter than either end.
 */
function wetDry(ctx: BaseAudioContext, mix: number) {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const out = ctx.createGain();
  input.connect(dry).connect(out);
  wet.connect(out);
  const set = (m: number, smooth = true) => {
    const d = Math.cos((m * Math.PI) / 2);
    const w = Math.sin((m * Math.PI) / 2);
    if (smooth) {
      smoothSet(dry.gain, d, ctx);
      smoothSet(wet.gain, w, ctx);
    } else {
      dry.gain.value = d;
      wet.gain.value = w;
    }
  };
  set(mix, false);
  return {
    input,
    wet,
    out,
    set,
    dispose() {
      for (const n of [input, dry, wet, out]) n.disconnect();
    },
  };
}

/** Soft clipping for feedback loops, so a delay pushed hard saturates like tape instead of exploding. */
function softClip(ctx: BaseAudioContext): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.5) / Math.tanh(1.5);
  shaper.curve = curve;
  return shaper;
}

/** Clocks per echo when a delay is synced, or 0 for its own time. */
export const DELAY_SYNC = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
export const DELAY_SYNC_LABELS = DELAY_SYNC.map((n) => (n === 0 ? 'Free (use Time)' : n === 1 ? '1 clock' : `${n} clocks`));

/** Tape-style echo: darkening, saturating repeats with a little wow and flutter. Syncs to a clock. */
export const delay: ModuleType = {
  def: {
    type: 'delay',
    label: 'Tape Delay',
    category: 'Effects',
    presets: true,
    description: 'Echoes that darken and saturate as they repeat, with tape wow. Patch a clock in and pick a Sync to lock the echoes to the beat.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio' },
      { id: 'clock', label: 'Clock', kind: 'gate' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'time', label: 'Time', min: 0.01, max: 2, default: 0.375, unit: 's', curve: 'exp' },
      { id: 'sync', label: 'Sync', min: 0, max: DELAY_SYNC.length - 1, default: 0, step: 1, options: DELAY_SYNC_LABELS },
      { id: 'feedback', label: 'Feedback', min: 0, max: 0.98, default: 0.45, step: 0.01 },
      { id: 'tone', label: 'Tone', min: 300, max: 16000, default: 3500, unit: 'Hz', curve: 'exp' },
      { id: 'wow', label: 'Wow', min: 0, max: 1, default: 0.2, step: 0.01 },
      MIX,
    ],
    face: ['time', 'feedback', 'mix'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const io = wetDry(ctx, p.mix);
    const line = ctx.createDelay(4);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    const clip = softClip(ctx);
    const fb = ctx.createGain();
    // in → delay → tone → saturation → wet, and back round through the feedback gain.
    io.input.connect(line);
    line.connect(tone).connect(clip).connect(io.wet);
    clip.connect(fb).connect(line);
    // Wow: a slow wobble of the delay time, plus faster flutter, both scaled by Wow.
    const wow = ctx.createOscillator();
    const flutter = ctx.createOscillator();
    wow.frequency.value = 0.55;
    flutter.frequency.value = 6.3;
    const wowDepth = ctx.createGain();
    const flutterDepth = ctx.createGain();
    wow.connect(wowDepth).connect(line.delayTime);
    flutter.connect(flutterDepth).connect(line.delayTime);
    wow.start();
    flutter.start();
    const follower = new ClockFollower();
    let period: number | null = null;
    const time = () => {
      const clocks = DELAY_SYNC[Math.round(p.sync)] ?? 0;
      return clocks && period ? Math.min(3.9, period * clocks) : p.time;
    };
    const apply = (smooth: boolean) => {
      const set = (param: AudioParam, v: number) => (smooth ? smoothSet(param, v, ctx, 0.05) : (param.value = v));
      set(line.delayTime, time());
      set(fb.gain, p.feedback);
      set(tone.frequency, p.tone);
      set(wowDepth.gain, p.wow * 0.004);
      set(flutterDepth.gain, p.wow * 0.0004);
    };
    apply(false);
    return {
      inputs: {
        in: { kind: 'node', node: io.input },
        clock: {
          kind: 'gate',
          handler: (e) => {
            const r = follower.tick(e.time, 1);
            if (r.rate === null) return;
            const next = 1 / r.rate;
            // Follow tempo changes, but ignore the jitter of every tick.
            if (period === null || Math.abs(next - period) > period * 0.02) {
              period = next;
              if (p.sync) smoothSet(line.delayTime, time(), ctx, 0.05);
            }
          },
        },
      },
      outputs: { out: { kind: 'node', node: io.out } },
      setParam(id, v) {
        p[id] = v;
        if (id === 'mix') io.set(v);
        else apply(true);
      },
      dispose() {
        wow.stop();
        flutter.stop();
        for (const n of [line, tone, clip, fb, wowDepth, flutterDepth]) n.disconnect();
        io.dispose();
      },
    };
  },
};

/**
 * A room made from noise: an impulse response of decaying stereo noise that
 * darkens as it fades, played through a convolver.
 */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, damping: number, random: () => number = Math.random): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.round(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // -60 dB by the end; the low-pass closes over time so the tail gets darker.
      const env = Math.pow(0.001, t);
      const coef = Math.min(0.97, damping * t * 0.97);
      lp = (random() * 2 - 1) * (1 - coef) + lp * coef;
      data[i] = lp * env;
    }
  }
  return buf;
}

/** Stereo reverb: Size is the tail length, Damping darkens it, Pre-delay spaces it from the dry sound. */
export const reverb: ModuleType = {
  def: {
    type: 'reverb',
    label: 'Reverb',
    category: 'Effects',
    presets: true,
    description: 'A stereo room, from small to huge. Out is mono; L and R are the stereo tail with the dry sound in the middle.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [
      { id: 'out', label: 'Out', kind: 'audio' },
      { id: 'left', label: 'L', kind: 'audio' },
      { id: 'right', label: 'R', kind: 'audio' },
    ],
    params: [
      { id: 'size', label: 'Size', min: 0.2, max: 12, default: 2.2, unit: 's', curve: 'exp' },
      { id: 'damping', label: 'Damping', min: 0, max: 1, default: 0.5, step: 0.01 },
      { id: 'predelay', label: 'Pre-delay', min: 0, max: 0.25, default: 0.015, unit: 's', step: 0.001 },
      MIX,
    ],
    face: ['size', 'damping', 'mix'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const io = wetDry(ctx, p.mix);
    io.out.channelCount = 2;
    io.out.channelCountMode = 'explicit';
    const pre = ctx.createDelay(1);
    pre.delayTime.value = p.predelay;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, p.size, p.damping);
    io.input.connect(pre).connect(conv).connect(io.wet);
    const split = ctx.createChannelSplitter(2);
    io.out.connect(split);
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    io.out.connect(mono);
    // Building a long impulse takes a moment, so wait for a slider (or a cable on it) to settle first.
    let built = `${p.size}:${p.damping}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rebuild = () => {
      timer = null;
      const key = `${p.size.toFixed(2)}:${p.damping.toFixed(2)}`;
      if (key === built) return;
      built = key;
      conv.buffer = makeImpulse(ctx, p.size, p.damping);
    };
    return {
      inputs: { in: { kind: 'node', node: io.input } },
      outputs: { out: { kind: 'node', node: mono }, left: { kind: 'node', node: split, index: 0 }, right: { kind: 'node', node: split, index: 1 } },
      setParam(id, v) {
        p[id] = v;
        if (id === 'mix') io.set(v);
        else if (id === 'predelay') smoothSet(pre.delayTime, v, ctx);
        else timer ??= setTimeout(rebuild, 250);
      },
      dispose() {
        if (timer) clearTimeout(timer);
        for (const n of [pre, conv, split, mono]) n.disconnect();
        io.dispose();
      },
    };
  },
};

/** Phaser: a chain of all-pass stages swept by an LFO, mixed with the dry sound for moving notches. */
export const phaser: ModuleType = {
  def: {
    type: 'phaser',
    label: 'Phaser',
    category: 'Effects',
    presets: true,
    description: 'Sweeping notches that swirl through the sound. More stages, deeper swirl.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'rate', label: 'Rate', min: 0.02, max: 8, default: 0.3, unit: 'Hz', curve: 'exp' },
      { id: 'depth', label: 'Depth', min: 0, max: 1, default: 0.7, step: 0.01 },
      { id: 'center', label: 'Centre', min: 100, max: 4000, default: 700, unit: 'Hz', curve: 'exp' },
      { id: 'resonance', label: 'Resonance', min: 0.3, max: 6, default: 0.8, curve: 'exp' },
      { id: 'stages', label: 'Stages', min: 0, max: 2, default: 1, step: 1, options: ['4', '6', '8'] },
      { ...MIX, default: 0.5 },
    ],
    face: ['rate', 'depth', 'mix'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const io = wetDry(ctx, p.mix);
    const send = ctx.createGain();
    io.input.connect(send);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.rate;
    const sweep = ctx.createGain();
    lfo.connect(sweep);
    lfo.start();
    let stages: BiquadFilterNode[] = [];
    let count = 0;
    const build = () => {
      count = [4, 6, 8][Math.round(p.stages)] ?? 6;
      send.disconnect();
      for (const f of stages) f.disconnect();
      stages = Array.from({ length: count }, () => {
        const f = ctx.createBiquadFilter();
        f.type = 'allpass';
        sweep.connect(f.frequency);
        return f;
      });
      stages.reduce<AudioNode>((prev, f) => prev.connect(f), send).connect(io.wet);
      apply(false);
    };
    // The LFO swings each stage's frequency around Centre by up to 90% of it.
    const apply = (smooth: boolean) => {
      const set = (param: AudioParam, v: number) => (smooth ? smoothSet(param, v, ctx) : (param.value = v));
      set(lfo.frequency, p.rate);
      set(sweep.gain, p.center * 0.9 * p.depth);
      for (const f of stages) {
        set(f.frequency, p.center);
        set(f.Q, p.resonance);
      }
    };
    build();
    return {
      inputs: { in: { kind: 'node', node: io.input } },
      outputs: { out: { kind: 'node', node: io.out } },
      setParam(id, v) {
        p[id] = v;
        if (id === 'mix') io.set(v);
        else if (id === 'stages') {
          if (([4, 6, 8][Math.round(v)] ?? 6) !== count) build();
        } else apply(true);
      },
      dispose() {
        lfo.stop();
        for (const n of [send, sweep, ...stages]) n.disconnect();
        io.dispose();
      },
    };
  },
};

/** Effects built on the per-sample delay line: they send settings to it and, for the comb, notes. */
function modDelayNode(ctx: BaseAudioContext) {
  const node = new AudioWorkletNode(ctx, 'mb-moddelay', { numberOfInputs: 1, outputChannelCount: [1] });
  return { node, send: (msg: ModDelayMessage) => node.port.postMessage(msg) };
}

/** Flanger: a very short delay swept by an LFO and fed back, for jet-plane sweeps. */
export const flanger: ModuleType = {
  worklets: [moddelayWorkletUrl],
  def: {
    type: 'flanger',
    label: 'Flanger',
    category: 'Effects',
    presets: true,
    description: 'A jet-plane sweep from a tiny delay moving back and forth. Negative feedback sounds hollow, positive sounds metallic.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'rate', label: 'Rate', min: 0.02, max: 5, default: 0.2, unit: 'Hz', curve: 'exp' },
      { id: 'depth', label: 'Depth', min: 0, max: 1, default: 0.6, step: 0.01 },
      { id: 'delay', label: 'Delay', min: 0.0005, max: 0.015, default: 0.002, unit: 's', curve: 'exp' },
      { id: 'feedback', label: 'Feedback', min: -0.95, max: 0.95, default: 0.6, step: 0.01 },
      { ...MIX, default: 0.5 },
    ],
    face: ['rate', 'depth', 'feedback'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const { node, send } = modDelayNode(ctx);
    const apply = () =>
      send({ type: 'settings', settings: { delay: p.delay, rate: p.rate, depth: p.depth * 0.008, feedback: p.feedback, damp: 0.1, mix: p.mix } });
    apply();
    return {
      inputs: { in: { kind: 'node', node } },
      outputs: { out: { kind: 'node', node } },
      setParam(id, v) {
        p[id] = v;
        apply();
      },
      dispose() {
        send({ type: 'dispose' });
        node.disconnect();
      },
    };
  },
};

const midiHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/**
 * Comb filter: a delay tuned to a pitch and fed back, so anything through it
 * rings at that note. Patch notes in and it follows the melody, like a
 * resonator. Strike it with noise or drums for Karplus-style plucks.
 */
export const comb: ModuleType = {
  worklets: [moddelayWorkletUrl],
  def: {
    type: 'comb',
    label: 'Comb',
    category: 'Effects',
    presets: true,
    description: 'Makes anything ring at a pitch. Patch notes into it and the ringing follows the melody.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio' },
      { id: 'notes', label: 'Notes', kind: 'gate' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'freq', label: 'Pitch', min: 20, max: 4000, default: 220, unit: 'Hz', curve: 'exp' },
      { id: 'feedback', label: 'Ring', min: -0.98, max: 0.98, default: 0.85, step: 0.01 },
      { id: 'damp', label: 'Damping', min: 0, max: 0.9, default: 0.3, step: 0.01 },
      { ...MIX, default: 0.6 },
    ],
    face: ['freq', 'feedback', 'damp'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const { node, send } = modDelayNode(ctx);
    let noteHz: number | null = null;
    const apply = () =>
      send({ type: 'settings', settings: { delay: 1 / (noteHz ?? p.freq), rate: 0, depth: 0, feedback: p.feedback, damp: p.damp, mix: p.mix } });
    apply();
    return {
      inputs: {
        in: { kind: 'node', node },
        notes: {
          kind: 'gate',
          handler: (e) => {
            if (e.note === undefined) return;
            noteHz = midiHz(e.note);
            send({ type: 'event', event: { time: e.time, delay: 1 / noteHz } });
          },
        },
      },
      outputs: { out: { kind: 'node', node } },
      setParam(id, v) {
        p[id] = v;
        // Moving Pitch takes the comb back from following notes.
        if (id === 'freq') noteHz = null;
        apply();
      },
      dispose() {
        send({ type: 'dispose' });
        node.disconnect();
      },
    };
  },
};

const RING_WAVES: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

/** Ring modulator: multiplies the input by a carrier, for bells, robots and clangour. */
export const ringMod: ModuleType = {
  def: {
    type: 'ringmod',
    label: 'Ring Mod',
    category: 'Effects',
    presets: true,
    description: 'Multiplies the sound by a carrier wave: metallic, bell-like, robotic. Patch any audio into Carrier to use it instead.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio' },
      { id: 'carrier', label: 'Carrier', kind: 'audio' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'freq', label: 'Freq', min: 1, max: 5000, default: 440, unit: 'Hz', curve: 'exp' },
      { id: 'wave', label: 'Wave', min: 0, max: 3, default: 0, step: 1, options: ['Sine', 'Triangle', 'Square', 'Saw'] },
      { id: 'osc', label: 'Own carrier', min: 0, max: 1, default: 1, step: 1, options: ['Off (use input)', 'On'] },
      { ...MIX, default: 0.8 },
    ],
    face: ['freq', 'wave', 'mix'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const io = wetDry(ctx, p.mix);
    const vca = ctx.createGain();
    vca.gain.value = 0;
    io.input.connect(vca).connect(io.wet);
    const osc = ctx.createOscillator();
    osc.type = RING_WAVES[Math.round(p.wave)] ?? 'sine';
    osc.frequency.value = p.freq;
    const oscLevel = ctx.createGain();
    oscLevel.gain.value = p.osc;
    osc.connect(oscLevel).connect(vca.gain);
    osc.start();
    return {
      inputs: { in: { kind: 'node', node: io.input }, carrier: { kind: 'param', param: vca.gain } },
      outputs: { out: { kind: 'node', node: io.out } },
      setParam(id, v) {
        p[id] = v;
        if (id === 'mix') io.set(v);
        else if (id === 'freq') smoothSet(osc.frequency, v, ctx);
        else if (id === 'wave') osc.type = RING_WAVES[Math.round(v)] ?? 'sine';
        else if (id === 'osc') smoothSet(oscLevel.gain, v >= 0.5 ? 1 : 0, ctx);
      },
      dispose() {
        osc.stop();
        for (const n of [vca, osc, oscLevel]) n.disconnect();
        io.dispose();
      },
    };
  },
};

export const GLITCH_SLICES = [0.125, 0.25, 0.5, 1, 2];
export const GLITCH_SLICE_LABELS = ['⅛ clock', '¼ clock', '½ clock', '1 clock', '2 clocks'];

/**
 * Glitch: on each clock it may grab the slice it just heard and stutter it,
 * sometimes backwards, with bit and sample-rate crushing on top.
 */
export const glitch: ModuleType = {
  worklets: [glitchWorkletUrl],
  def: {
    type: 'glitch',
    label: 'Glitch',
    category: 'Effects',
    presets: true,
    description: 'Stutters, reverses and crushes. Patch a clock in: on each tick it may grab what it just heard and repeat it.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio' },
      { id: 'clock', label: 'Clock', kind: 'gate' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'chance', label: 'Chance', min: 0, max: 1, default: 0.25, step: 0.01 },
      { id: 'slice', label: 'Slice', min: 0, max: GLITCH_SLICES.length - 1, default: 1, step: 1, options: GLITCH_SLICE_LABELS },
      { id: 'repeats', label: 'Repeats', min: 1, max: 16, default: 4, step: 1 },
      { id: 'reverse', label: 'Reverse', min: 0, max: 1, default: 0.2, step: 0.01 },
      { id: 'bits', label: 'Bits', min: 1, max: 16, default: 16, step: 1 },
      { id: 'downsample', label: 'Downsample', min: 1, max: 32, default: 1, step: 1 },
      { ...MIX, default: 1 },
    ],
    face: ['chance', 'repeats', 'bits'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const node = new AudioWorkletNode(ctx, 'mb-glitch', { numberOfInputs: 1, outputChannelCount: [1] });
    const send = (msg: GlitchMessage) => node.port.postMessage(msg);
    const apply = () =>
      send({
        type: 'settings',
        settings: { chance: p.chance, repeats: p.repeats, reverse: p.reverse, bits: p.bits, downsample: p.downsample, mix: p.mix },
      });
    apply();
    const follower = new ClockFollower();
    let period = 0.125;
    return {
      inputs: {
        in: { kind: 'node', node },
        clock: {
          kind: 'gate',
          handler: (e) => {
            const r = follower.tick(e.time, 1);
            if (r.rate !== null) period = 1 / r.rate;
            send({ type: 'trigger', trigger: { time: e.time, slice: period * (GLITCH_SLICES[Math.round(p.slice)] ?? 0.25) } });
          },
        },
      },
      outputs: { out: { kind: 'node', node } },
      setParam(id, v) {
        p[id] = v;
        apply();
      },
      dispose() {
        send({ type: 'dispose' });
        node.disconnect();
      },
    };
  },
};
