import { ALGORITHM_DIAGRAMS, ALGORITHMS, defaultFMParams, type FMParams } from '../dsp/fm';
import type { FMMessage } from '../dsp/fm.worklet';
import fmWorkletUrl from '../dsp/fm.worklet.ts?worker&url';
import type { ParamDef, Preset } from '../patch/types';
import type { ModuleType } from './types';

const OPS = [1, 2, 3, 4];
const defaults = defaultFMParams();

function opParams(n: number): ParamDef[] {
  const d = defaults.ops[n - 1];
  return [
    { id: `op${n}Ratio`, label: 'Ratio', min: 0.125, max: 16, default: d.ratio, step: 0.005, curve: 'exp' },
    { id: `op${n}Fine`, label: 'Fine', min: -100, max: 100, default: d.fine, step: 1, unit: 'ct' },
    { id: `op${n}Level`, label: 'Level', min: 0, max: 1, default: d.level, step: 0.005 },
    { id: `op${n}Attack`, label: 'Attack', min: 0.001, max: 4, default: d.attack, unit: 's', curve: 'exp' },
    { id: `op${n}Decay`, label: 'Decay', min: 0.005, max: 8, default: d.decay, unit: 's', curve: 'exp' },
    { id: `op${n}Sustain`, label: 'Sustain', min: 0, max: 1, default: d.sustain, step: 0.005 },
    { id: `op${n}Release`, label: 'Release', min: 0.005, max: 8, default: d.release, unit: 's', curve: 'exp' },
  ];
}

/** Build the synth's param block from the module's flat param map. */
export function toFMParams(p: Record<string, number>): FMParams {
  return {
    algorithm: Math.round(p.algorithm) - 1,
    feedback: p.feedback,
    level: p.level,
    ops: OPS.map((n) => ({
      ratio: p[`op${n}Ratio`],
      fine: p[`op${n}Fine`],
      level: p[`op${n}Level`],
      attack: p[`op${n}Attack`],
      decay: p[`op${n}Decay`],
      sustain: p[`op${n}Sustain`],
      release: p[`op${n}Release`],
    })),
  };
}

/** 4-operator FM voice, 6-voice polyphonic, played by note gates. */
export const fmVoice: ModuleType = {
  worklets: [fmWorkletUrl],
  def: {
    type: 'fm',
    category: 'Sound',
    presets: true,
    label: 'FM Voice',
    description: '4-operator FM synth with 8 algorithms. Play it from a sequencer.',
    inputs: [{ id: 'gate', label: 'Notes', kind: 'gate' }],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { id: 'algorithm', label: 'Algorithm', min: 1, max: ALGORITHMS.length, default: defaults.algorithm + 1, step: 1, options: ALGORITHM_DIAGRAMS.map((d, i) => `${i + 1}: ${d}`) },
      { id: 'feedback', label: 'Feedback', min: 0, max: 1, default: defaults.feedback, step: 0.005 },
      { id: 'level', label: 'Level', min: 0, max: 1, default: defaults.level, step: 0.01 },
      { id: 'transpose', label: 'Transpose', min: -36, max: 36, default: 0, step: 1, unit: 'st' },
      ...OPS.flatMap(opParams),
    ],
    face: ['algorithm', 'feedback', 'op2Level', 'op2Ratio'],
    groups: [
      { label: 'Voice', params: ['algorithm', 'feedback', 'level', 'transpose'] },
      ...OPS.map((n) => ({ label: `Operator ${n}${n === 4 ? ' (feedback)' : ''}`, params: opParams(n).map((p) => p.id) })),
    ],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const node = new AudioWorkletNode(ctx, 'mb-fm', { numberOfInputs: 0, outputChannelCount: [1] });
    const send = (msg: FMMessage) => node.port.postMessage(msg);
    send({ type: 'params', params: toFMParams(p) });
    let presets: (Preset | null)[] = [];
    return {
      inputs: {
        gate: {
          kind: 'gate',
          // A note carrying a preset number plays with that preset's sound, so one voice can be a whole kit.
          // Parameter locks on the note then override single settings on top.
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
                params: own ? toFMParams(src) : undefined,
              },
            });
          },
        },
      },
      outputs: { out: { kind: 'node', node } },
      setParam(id, v) {
        p[id] = v;
        if (id !== 'transpose') send({ type: 'params', params: toFMParams(p) });
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
