import type { ParamDef } from '../patch/types';
import { NOTE_NAMES, SCALES } from './sequencer';

/** A CV output: a steady level the module sets at exact audio times. */
export function cvSource(ctx: BaseAudioContext) {
  const node = ctx.createConstantSource();
  node.offset.value = 0;
  node.start();
  return {
    node,
    set(value: number, time: number) {
      node.offset.setValueAtTime(value, Math.max(time, ctx.currentTime));
    },
    dispose() {
      node.stop();
      node.disconnect();
    },
  };
}

/** Scale, root and base octave, for modules that turn numbers into notes. */
export const PITCH_PARAMS: ParamDef[] = [
  { id: 'scale', label: 'Scale', min: 0, max: SCALES.length - 1, default: 5, step: 1, options: SCALES.map((s) => s.name) },
  { id: 'root', label: 'Root', min: 0, max: 11, default: 0, step: 1, options: NOTE_NAMES },
  { id: 'octave', label: 'Octave', min: 1, max: 6, default: 3, step: 1 },
];

/** The `degree`-th note of a scale (0 = root at `octave`), climbing through octaves. */
export function scaleNote(degree: number, p: Record<string, number>): number {
  const scale = (SCALES[Math.round(p.scale ?? 0)] ?? SCALES[0]).intervals;
  const d = Math.max(0, Math.floor(degree));
  const note = 12 * (Math.round(p.octave ?? 3) + 1) + Math.round(p.root ?? 0) + 12 * Math.floor(d / scale.length) + scale[d % scale.length];
  return Math.min(127, Math.max(0, note));
}

/** Map 0..1 onto a scale spanning `octaves`, e.g. a ball's position onto a melody. */
export function unitToNote(x: number, octaves: number, p: Record<string, number>): number {
  const len = (SCALES[Math.round(p.scale ?? 0)] ?? SCALES[0]).intervals.length;
  const steps = Math.max(1, Math.round(len * octaves));
  return scaleNote(Math.min(steps - 1, Math.floor(Math.min(1, Math.max(0, x)) * steps)), p);
}
