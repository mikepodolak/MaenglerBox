import { defaultDrumParams, type DrumParams } from '../dsp/drum';
import { defaultLeadParams, type LeadParams } from '../dsp/lead';
import { defaultPadParams, type PadParams } from '../dsp/pad';
import { defaultTextureParams, type TextureParams } from '../dsp/texture';
import { defaultPluckParams, type PluckParams } from '../dsp/pluck';
import type { VoiceMessage } from '../dsp/voices.worklet';
import voicesWorkletUrl from '../dsp/voices.worklet.ts?worker&url';
import type { ModuleDef, Preset } from '../patch/types';
import type { ModuleType } from './types';

/**
 * A polyphonic voice played by note gates, like the FM Voice: a note
 * carrying a preset number plays with that preset, and parameter locks on
 * the note override single settings on top.
 */
function polyVoice<P>(def: ModuleDef, processor: string, toParams: (p: Record<string, number>) => P): ModuleType {
  return {
    worklets: [voicesWorkletUrl],
    def,
    create({ ctx }, params) {
      const p = { ...params };
      const node = new AudioWorkletNode(ctx, processor, { numberOfInputs: 0, outputChannelCount: [1] });
      const send = (msg: VoiceMessage<P>) => node.port.postMessage(msg);
      send({ type: 'params', params: toParams(p) });
      let presets: (Preset | null)[] = [];
      return {
        inputs: {
          gate: {
            kind: 'gate',
            handler: (e) => {
              const preset = e.index ? presets[e.index - 1] : null;
              const own = preset || e.params;
              const src = own ? { ...p, ...preset?.params, ...e.params } : p;
              send({
                type: 'note',
                event: {
                  time: e.time,
                  note: (e.note ?? 60) + src.transpose,
                  velocity: e.value,
                  length: e.length,
                  params: own ? toParams(src) : undefined,
                },
              });
            },
          },
        },
        outputs: { out: { kind: 'node', node } },
        setParam(id, v) {
          p[id] = v;
          if (id !== 'transpose') send({ type: 'params', params: toParams(p) });
        },
        setPresets(list) {
          presets = list;
        },
        dispose() {
          send({ type: 'dispose' });
          node.disconnect();
        },
      };
    },
  };
}

const lead0 = defaultLeadParams();
const TRANSPOSE = { id: 'transpose', label: 'Transpose', min: -36, max: 36, default: 0, step: 1, unit: 'st' };

export const fmLead = polyVoice<LeadParams>(
  {
    type: 'lead',
    label: 'FM Lead',
    category: 'Sound',
    presets: true,
    description: 'Two-operator FM through a resonant filter, Nord Lead 2 style. Punchy basses, bells and leads.',
    inputs: [{ id: 'gate', label: 'Notes', kind: 'gate' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'ratio', label: 'Ratio', min: 0.5, max: 16, default: lead0.ratio, step: 0.5 },
      { id: 'fine', label: 'Fine', min: -100, max: 100, default: lead0.fine, step: 1, unit: 'ct' },
      { id: 'index', label: 'FM amount', min: 0, max: 1, default: lead0.index, step: 0.005 },
      { id: 'feedback', label: 'Feedback', min: 0, max: 1, default: lead0.feedback, step: 0.005 },
      { id: 'modAttack', label: 'Attack', min: 0.001, max: 4, default: lead0.modAttack, unit: 's', curve: 'exp' },
      { id: 'modDecay', label: 'Decay', min: 0.005, max: 8, default: lead0.modDecay, unit: 's', curve: 'exp' },
      { id: 'modSustain', label: 'Sustain', min: 0, max: 1, default: lead0.modSustain, step: 0.005 },
      { id: 'cutoff', label: 'Cutoff', min: 40, max: 16000, default: lead0.cutoff, unit: 'Hz', curve: 'exp' },
      { id: 'resonance', label: 'Resonance', min: 0.5, max: 15, default: lead0.resonance, curve: 'exp' },
      { id: 'filterEnv', label: 'Env amount', min: -4, max: 6, default: lead0.filterEnv, step: 0.01, unit: 'oct' },
      { id: 'filterDecay', label: 'Env decay', min: 0.005, max: 4, default: lead0.filterDecay, unit: 's', curve: 'exp' },
      { id: 'attack', label: 'Attack', min: 0.001, max: 4, default: lead0.attack, unit: 's', curve: 'exp' },
      { id: 'decay', label: 'Decay', min: 0.005, max: 8, default: lead0.decay, unit: 's', curve: 'exp' },
      { id: 'sustain', label: 'Sustain', min: 0, max: 1, default: lead0.sustain, step: 0.005 },
      { id: 'release', label: 'Release', min: 0.005, max: 8, default: lead0.release, unit: 's', curve: 'exp' },
      { id: 'level', label: 'Level', min: 0, max: 1, default: lead0.level, step: 0.01 },
      TRANSPOSE,
    ],
    face: ['ratio', 'index', 'cutoff', 'resonance'],
    groups: [
      { label: 'FM', params: ['ratio', 'fine', 'index', 'feedback'] },
      { label: 'FM envelope', params: ['modAttack', 'modDecay', 'modSustain'] },
      { label: 'Filter', params: ['cutoff', 'resonance', 'filterEnv', 'filterDecay'] },
      { label: 'Amp', params: ['attack', 'decay', 'sustain', 'release', 'level', 'transpose'] },
    ],
  },
  'mb-lead',
  (p) => ({
    ratio: p.ratio,
    fine: p.fine,
    index: p.index,
    modAttack: p.modAttack,
    modDecay: p.modDecay,
    modSustain: p.modSustain,
    feedback: p.feedback,
    attack: p.attack,
    decay: p.decay,
    sustain: p.sustain,
    release: p.release,
    cutoff: p.cutoff,
    resonance: p.resonance,
    filterEnv: p.filterEnv,
    filterDecay: p.filterDecay,
    level: p.level,
  }),
);

const pluck0 = defaultPluckParams();

export const pluck = polyVoice<PluckParams>(
  {
    type: 'pluck',
    label: 'Pluck',
    category: 'Sound',
    presets: true,
    description: 'Karplus-Strong plucked string: guitars, harps, kalimbas, clangs. Plays notes.',
    inputs: [{ id: 'gate', label: 'Notes', kind: 'gate' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'decay', label: 'Decay', min: 0.05, max: 12, default: pluck0.decay, unit: 's', curve: 'exp' },
      { id: 'brightness', label: 'Brightness', min: 0, max: 1, default: pluck0.brightness, step: 0.005 },
      { id: 'pluck', label: 'Pluck', min: 0, max: 1, default: pluck0.pluck, step: 0.005 },
      { id: 'position', label: 'Position', min: 0, max: 0.5, default: pluck0.position, step: 0.005 },
      { id: 'release', label: 'Release', min: 0.01, max: 4, default: pluck0.release, unit: 's', curve: 'exp' },
      { id: 'level', label: 'Level', min: 0, max: 1, default: pluck0.level, step: 0.01 },
      TRANSPOSE,
    ],
    face: ['decay', 'brightness', 'pluck'],
  },
  'mb-pluck',
  (p) => ({ decay: p.decay, brightness: p.brightness, pluck: p.pluck, position: p.position, release: p.release, level: p.level }),
);

/** The settings a voice's DSP reads, taken from the module's params by the keys of its defaults. */
function pick<P extends object>(defaults: P): (p: Record<string, number>) => P {
  const keys = Object.keys(defaults) as (keyof P & string)[];
  return (p) => Object.fromEntries(keys.map((k) => [k, p[k] ?? (defaults[k] as number)])) as P;
}

const drum0 = defaultDrumParams();

export const fmDrum = polyVoice<DrumParams>(
  {
    type: 'drum',
    label: 'FM Drum',
    category: 'Sound',
    presets: true,
    description: 'FM percussion: a swept sine body bent by a fast FM modulator, plus a burst of noise. Kicks, toms, snares, hats and metal.',
    inputs: [{ id: 'gate', label: 'Hits', kind: 'gate' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'pitch', label: 'Pitch', min: 20, max: 2000, default: drum0.pitch, unit: 'Hz', curve: 'exp' },
      { id: 'track', label: 'Follow notes', min: 0, max: 1, default: drum0.track, step: 0.01 },
      { id: 'sweep', label: 'Sweep', min: 0, max: 6, default: drum0.sweep, step: 0.01, unit: 'oct' },
      { id: 'sweepTime', label: 'Sweep time', min: 0.002, max: 1, default: drum0.sweepTime, unit: 's', curve: 'exp' },
      { id: 'ratio', label: 'Ratio', min: 0.25, max: 16, default: drum0.ratio, step: 0.01, curve: 'exp' },
      { id: 'fm', label: 'FM amount', min: 0, max: 1, default: drum0.fm, step: 0.005 },
      { id: 'fmDecay', label: 'FM decay', min: 0.002, max: 2, default: drum0.fmDecay, unit: 's', curve: 'exp' },
      { id: 'feedback', label: 'Feedback', min: 0, max: 1, default: drum0.feedback, step: 0.005 },
      { id: 'noise', label: 'Noise', min: 0, max: 1, default: drum0.noise, step: 0.005 },
      { id: 'noiseTone', label: 'Noise tone', min: 100, max: 16000, default: drum0.noiseTone, unit: 'Hz', curve: 'exp' },
      { id: 'noiseDecay', label: 'Noise decay', min: 0.005, max: 2, default: drum0.noiseDecay, unit: 's', curve: 'exp' },
      { id: 'decay', label: 'Decay', min: 0.01, max: 4, default: drum0.decay, unit: 's', curve: 'exp' },
      { id: 'drive', label: 'Drive', min: 0, max: 1, default: drum0.drive, step: 0.01 },
      { id: 'level', label: 'Level', min: 0, max: 1, default: drum0.level, step: 0.01 },
      TRANSPOSE,
    ],
    face: ['pitch', 'fm', 'noise', 'decay'],
    groups: [
      { label: 'Body', params: ['pitch', 'track', 'sweep', 'sweepTime', 'decay'] },
      { label: 'FM', params: ['ratio', 'fm', 'fmDecay', 'feedback'] },
      { label: 'Noise', params: ['noise', 'noiseTone', 'noiseDecay'] },
      { label: 'Output', params: ['drive', 'level', 'transpose'] },
    ],
  },
  'mb-drum',
  pick(drum0),
);

const pad0 = defaultPadParams();

export const pad = polyVoice<PadParams>(
  {
    type: 'pad',
    label: 'Pad',
    category: 'Sound',
    presets: true,
    description: 'Three drifting, detuned oscillators and a sub through a slow resonant filter. Pads, strings and washes.',
    inputs: [{ id: 'gate', label: 'Notes', kind: 'gate' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'shape', label: 'Shape', min: 0, max: 1, default: pad0.shape, step: 0.01 },
      { id: 'detune', label: 'Detune', min: 0, max: 50, default: pad0.detune, step: 0.5, unit: 'ct' },
      { id: 'sub', label: 'Sub', min: 0, max: 1, default: pad0.sub, step: 0.01 },
      { id: 'drift', label: 'Drift', min: 0, max: 40, default: pad0.drift, step: 0.5, unit: 'ct' },
      { id: 'cutoff', label: 'Cutoff', min: 40, max: 16000, default: pad0.cutoff, unit: 'Hz', curve: 'exp' },
      { id: 'resonance', label: 'Resonance', min: 0.5, max: 12, default: pad0.resonance, curve: 'exp' },
      { id: 'filterEnv', label: 'Env amount', min: -3, max: 5, default: pad0.filterEnv, step: 0.01, unit: 'oct' },
      { id: 'filterAttack', label: 'Env attack', min: 0.005, max: 10, default: pad0.filterAttack, unit: 's', curve: 'exp' },
      { id: 'filterDecay', label: 'Env decay', min: 0.01, max: 12, default: pad0.filterDecay, unit: 's', curve: 'exp' },
      { id: 'attack', label: 'Attack', min: 0.002, max: 10, default: pad0.attack, unit: 's', curve: 'exp' },
      { id: 'decay', label: 'Decay', min: 0.01, max: 12, default: pad0.decay, unit: 's', curve: 'exp' },
      { id: 'sustain', label: 'Sustain', min: 0, max: 1, default: pad0.sustain, step: 0.01 },
      { id: 'release', label: 'Release', min: 0.01, max: 12, default: pad0.release, unit: 's', curve: 'exp' },
      { id: 'level', label: 'Level', min: 0, max: 1, default: pad0.level, step: 0.01 },
      TRANSPOSE,
    ],
    face: ['shape', 'detune', 'cutoff', 'attack'],
    groups: [
      { label: 'Oscillators', params: ['shape', 'detune', 'sub', 'drift'] },
      { label: 'Filter', params: ['cutoff', 'resonance', 'filterEnv', 'filterAttack', 'filterDecay'] },
      { label: 'Amp', params: ['attack', 'decay', 'sustain', 'release', 'level', 'transpose'] },
    ],
  },
  'mb-pad',
  pick(pad0),
);

const texture0 = defaultTextureParams();

export const texture = polyVoice<TextureParams>(
  {
    type: 'texture',
    label: 'Texture',
    category: 'Sound',
    presets: true,
    description: 'Each note becomes a cloud of tiny grains, sine or noise, scattered around its pitch. Glitter, hiss, breath and drones.',
    inputs: [{ id: 'gate', label: 'Notes', kind: 'gate' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'density', label: 'Density', min: 1, max: 300, default: texture0.density, unit: '/s', curve: 'exp' },
      { id: 'grain', label: 'Grain', min: 0.005, max: 0.5, default: texture0.grain, unit: 's', curve: 'exp' },
      { id: 'scatter', label: 'Scatter', min: 0, max: 36, default: texture0.scatter, step: 0.1, unit: 'st' },
      { id: 'harmonic', label: 'Harmonic', min: 0, max: 1, default: texture0.harmonic, step: 0.01 },
      { id: 'noise', label: 'Noise', min: 0, max: 1, default: texture0.noise, step: 0.01 },
      { id: 'focus', label: 'Focus', min: 0.5, max: 40, default: texture0.focus, curve: 'exp' },
      { id: 'attack', label: 'Attack', min: 0.005, max: 10, default: texture0.attack, unit: 's', curve: 'exp' },
      { id: 'release', label: 'Release', min: 0.01, max: 12, default: texture0.release, unit: 's', curve: 'exp' },
      { id: 'level', label: 'Level', min: 0, max: 1, default: texture0.level, step: 0.01 },
      TRANSPOSE,
    ],
    face: ['density', 'grain', 'scatter', 'noise'],
  },
  'mb-texture',
  pick(texture0),
);
