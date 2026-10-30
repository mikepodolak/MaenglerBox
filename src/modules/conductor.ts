import type { GateEvent } from '../engine/gate';
import { NOTE_NAMES, SCALES } from './sequencer';
import type { ModuleType } from './types';

/** The patch-wide key, scale and odds the Conductor sets for every voice. */
export interface Globals {
  active: boolean;
  root: number;
  scale: number;
  /** Chance each note reaches a voice, 0..1. */
  chance: number;
  transpose: number;
}

export function createGlobals(): Globals {
  return { active: false, root: 0, scale: 0, chance: 1, transpose: 0 };
}

/** Move a note to the nearest note of the scale (ties go up). */
export function quantizeNote(note: number, root: number, scale: number): number {
  const steps = (SCALES[Math.round(scale)] ?? SCALES[0]).intervals;
  const rel = (((note - root) % 12) + 12) % 12;
  let best = 0;
  let dist = Infinity;
  for (const s of [...steps, 12]) {
    const d = Math.abs(s - rel);
    if (d < dist || (d === dist && s > best)) {
      dist = d;
      best = s;
    }
  }
  return note - rel + best;
}

/**
 * What the Conductor does to a note on its way into a voice: transposes it,
 * moves it into the key, and lets it through only with the global chance.
 * Gates without a note (clocks, triggers) pass untouched.
 */
export function conduct(g: Globals | undefined, e: GateEvent, random: () => number = Math.random): GateEvent | null {
  if (!g?.active || e.note === undefined) return e;
  if (random() >= g.chance) return null;
  return { ...e, note: Math.min(127, Math.max(0, quantizeNote(e.note + Math.round(g.transpose), Math.round(g.root), g.scale))) };
}

/**
 * One per patch: sets the key, scale and overall chance for every voice.
 * Every note going into a synth or effect is moved into the key and thinned
 * by Chance, wherever it comes from, so a whole patch changes key at once.
 */
export const conductor: ModuleType = {
  def: {
    type: 'conductor',
    label: 'Conductor',
    category: 'Utility',
    visual: true,
    description: 'Sets the key, scale and overall note chance for every voice in the patch. Patch a cable onto Root or Chance to change them as it plays.',
    inputs: [],
    outputs: [],
    params: [
      { id: 'enabled', label: 'Conducting', min: 0, max: 1, default: 1, step: 1, options: ['Off', 'On'] },
      { id: 'root', label: 'Key', min: 0, max: 11, default: 0, step: 1, options: NOTE_NAMES },
      { id: 'scale', label: 'Scale', min: 0, max: SCALES.length - 1, default: 1, step: 1, options: SCALES.map((s) => s.name) },
      { id: 'chance', label: 'Chance', min: 0, max: 1, default: 1, step: 0.01 },
      { id: 'transpose', label: 'Transpose', min: -24, max: 24, default: 0, step: 1, unit: 'st' },
    ],
    face: ['root', 'scale', 'chance'],
  },
  create(env, params) {
    const p = { ...params };
    const g = env.globals;
    const apply = () => {
      if (!g) return;
      g.active = p.enabled >= 0.5;
      g.root = Math.round(p.root);
      g.scale = Math.round(p.scale);
      g.chance = p.chance;
      g.transpose = Math.round(p.transpose);
    };
    apply();
    return {
      inputs: {},
      outputs: {},
      setParam(id, v) {
        p[id] = v;
        apply();
      },
      getState: () => ({ root: Math.round(p.root), scale: Math.round(p.scale), on: p.enabled >= 0.5 }),
      dispose() {
        if (g) g.active = false;
      },
    };
  },
};
