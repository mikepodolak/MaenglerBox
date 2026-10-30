import { defaultLeadParams, type LeadParams } from '../dsp/lead';
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
