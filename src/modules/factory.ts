import { defaultParams } from '../patch/model';
import { PRESET_SLOTS } from '../patch/presets';
import type { ModuleDef, Preset, PresetLibrary } from '../patch/types';

type Sketch = [name: string, params: Record<string, number>];

/** FM operator settings, one array per operator: ratio, level, attack, decay, sustain, release (and fine). */
function ops(...o: [number, number, number, number, number, number, number?][]): Record<string, number> {
  const out: Record<string, number> = {};
  o.forEach(([ratio, level, attack, decay, sustain, release, fine = 0], i) => {
    const n = i + 1;
    Object.assign(out, { [`op${n}Ratio`]: ratio, [`op${n}Level`]: level, [`op${n}Attack`]: attack, [`op${n}Decay`]: decay, [`op${n}Sustain`]: sustain, [`op${n}Release`]: release, [`op${n}Fine`]: fine });
  });
  return out;
}

/**
 * Presets every synth starts with: a working palette for IDM, leaning on
 * the clipped FM percussion, glassy bells, detuned washes and grainy
 * textures of late-90s electronica. Loaded once into empty library slots.
 */
const FACTORY: Record<string, Sketch[]> = {
  drum: [
    ['Sub kick', { pitch: 46, sweep: 3, sweepTime: 0.03, ratio: 1, fm: 0.1, fmDecay: 0.01, noise: 0.02, decay: 0.65, drive: 0.3 }],
    ['Click kick', { pitch: 58, sweep: 4.5, sweepTime: 0.012, ratio: 2.7, fm: 0.35, fmDecay: 0.006, noise: 0.12, noiseTone: 6000, noiseDecay: 0.008, decay: 0.28, drive: 0.55 }],
    ['FM snare', { pitch: 190, sweep: 1, sweepTime: 0.02, ratio: 1.48, fm: 0.3, fmDecay: 0.02, noise: 0.6, noiseTone: 4500, noiseDecay: 0.16, decay: 0.12, drive: 0.35 }],
    ['Rim', { pitch: 880, sweep: 0.3, sweepTime: 0.005, ratio: 3.17, fm: 0.25, fmDecay: 0.01, noise: 0.05, noiseDecay: 0.01, decay: 0.05, drive: 0.2 }],
    ['Closed hat', { pitch: 420, sweep: 0, ratio: 7.13, fm: 0.9, fmDecay: 0.04, feedback: 0.5, noise: 0.7, noiseTone: 9000, noiseDecay: 0.035, decay: 0.03, drive: 0.1 }],
    ['Open hat', { pitch: 420, sweep: 0, ratio: 7.13, fm: 0.9, fmDecay: 0.3, feedback: 0.5, noise: 0.7, noiseTone: 8500, noiseDecay: 0.35, decay: 0.3, drive: 0.1 }],
    ['Metal tick', { pitch: 1200, track: 0.5, sweep: 0.5, sweepTime: 0.004, ratio: 5.41, fm: 0.8, fmDecay: 0.02, feedback: 0.7, noise: 0, decay: 0.04, drive: 0.6 }],
    ['Tuned blip', { pitch: 262, track: 1, sweep: 1.5, sweepTime: 0.01, ratio: 2, fm: 0.25, fmDecay: 0.05, noise: 0, decay: 0.18, drive: 0.2 }],
    ['Crushed tom', { pitch: 90, track: 0.3, sweep: 5.5, sweepTime: 0.08, ratio: 0.5, fm: 0.7, fmDecay: 0.2, feedback: 0.9, noise: 0.3, noiseTone: 1500, noiseDecay: 0.05, decay: 0.22, drive: 1 }],
    ['Shaker', { pitch: 2000, sweep: 0, fm: 0, noise: 1, noiseTone: 7000, noiseDecay: 0.06, decay: 0.01, drive: 0 }],
  ],
  fm: [
    ['DX bass', { algorithm: 1, feedback: 0.3, ...ops([1, 1, 0.002, 0.4, 0.3, 0.1], [1, 0.6, 0.001, 0.2, 0.1, 0.1], [3, 0.2, 0.001, 0.05, 0, 0.05], [1, 0, 0.001, 0.1, 0, 0.1]) }],
    ['Cold bell', { algorithm: 5, feedback: 0, ...ops([1, 1, 0.001, 3, 0, 2], [3.5, 0.45, 0.001, 2.5, 0, 2], [1, 0.6, 0.001, 1.5, 0, 1.5], [7, 0.3, 0.001, 1, 0, 1]) }],
    ['Glass keys', { algorithm: 7, feedback: 0.05, ...ops([1, 1, 0.002, 1.5, 0.2, 0.6], [2, 0.5, 0.002, 1, 0.1, 0.5], [1, 0.6, 0.002, 1.2, 0.15, 0.6], [14, 0.25, 0.001, 0.15, 0, 0.1]) }],
    ['Noise metal', { algorithm: 4, feedback: 0.9, ...ops([1, 1, 0.001, 0.25, 0, 0.1], [1.41, 0.7, 0.001, 0.2, 0, 0.1], [3.73, 0.6, 0.001, 0.15, 0, 0.1], [7.9, 0.5, 0.001, 0.1, 0, 0.1]) }],
    ['Soft organ', { algorithm: 8, feedback: 0, ...ops([1, 0.8, 0.6, 1, 0.7, 1.5], [2, 0.4, 0.8, 1, 0.6, 1.5, 4], [3, 0.25, 1, 1, 0.5, 1.5, -5], [0.5, 0.5, 0.5, 1, 0.8, 1.5]) }],
    ['Brass stab', { algorithm: 1, feedback: 0.2, ...ops([1, 1, 0.03, 0.3, 0.5, 0.2], [1, 0.55, 0.05, 0.3, 0.4, 0.2], [1, 0.3, 0.02, 0.2, 0.2, 0.2], [2, 0.1, 0.01, 0.1, 0, 0.1]) }],
  ],
  lead: [
    ['Acid FM bass', { ratio: 1, index: 0.55, modDecay: 0.15, modSustain: 0.1, feedback: 0.3, cutoff: 260, resonance: 3, level: 0.5, filterEnv: 4, filterDecay: 0.14, attack: 0.002, decay: 0.3, sustain: 0.5, release: 0.08, transpose: -24 }],
    ['Bell lead', { ratio: 3.5, index: 0.45, modAttack: 0.001, modDecay: 1.2, modSustain: 0.05, feedback: 0, cutoff: 9000, resonance: 0.8, filterEnv: 0, attack: 0.002, decay: 1.5, sustain: 0.2, release: 0.8 }],
    ['Hollow sync', { ratio: 2, fine: 7, index: 0.6, modDecay: 0.6, modSustain: 0.4, feedback: 0.6, cutoff: 2200, resonance: 3, filterEnv: 1.5, filterDecay: 0.4, attack: 0.005, sustain: 0.7, release: 0.3 }],
    ['Square pluck', { ratio: 1, index: 0.35, feedback: 0.85, modDecay: 0.1, modSustain: 0, cutoff: 1200, resonance: 3, filterEnv: 3, filterDecay: 0.09, attack: 0.001, decay: 0.2, sustain: 0, release: 0.15, level: 0.6 }],
    ['Glide whistle', { ratio: 1, index: 0.1, modDecay: 2, modSustain: 0.3, feedback: 0, cutoff: 5000, resonance: 6, filterEnv: -1, filterDecay: 1.5, attack: 0.15, decay: 1, sustain: 0.8, release: 1.2, transpose: 12 }],
  ],
  pluck: [
    ['Kalimba', { decay: 1.2, brightness: 0.3, pluck: 0.4, position: 0.2, release: 0.3 }],
    ['Harp', { decay: 4, brightness: 0.6, pluck: 0.6, position: 0.13, release: 1 }],
    ['Muted', { decay: 0.3, brightness: 0.1, pluck: 0.3, position: 0.25, release: 0.1 }],
    ['Steel string', { decay: 6, brightness: 0.95, pluck: 1, position: 0.05, release: 2 }],
    ['Koto', { decay: 2.5, brightness: 0.75, pluck: 0.8, position: 0.08, release: 0.5 }],
  ],
  pad: [
    ['Warm haze', {}],
    ['Glass choir', { shape: 0.9, detune: 8, sub: 0, drift: 4, cutoff: 2400, resonance: 4, filterEnv: 1, attack: 1.2, release: 3 }],
    ['Dusk detune', { shape: 0.1, detune: 32, sub: 0.2, drift: 16, cutoff: 1400, resonance: 1, filterEnv: 0.8, attack: 0.6, release: 3.5 }],
    ['Slow swell', { shape: 0.3, detune: 12, cutoff: 300, filterEnv: 3.5, filterAttack: 5, filterDecay: 6, attack: 4, decay: 4, sustain: 0.9, release: 5, level: 0.9 }],
    ['Dark drone', { shape: 0.5, detune: 20, sub: 0.8, drift: 10, cutoff: 200, resonance: 2, filterEnv: 0.5, attack: 2, sustain: 1, release: 6, transpose: -12 }],
    ['Bright strings', { shape: 0.05, detune: 18, sub: 0.1, drift: 5, cutoff: 3500, resonance: 0.9, filterEnv: 0.5, filterAttack: 0.3, attack: 0.3, decay: 1, sustain: 0.85, release: 1.2 }],
  ],
  texture: [
    ['Rain on glass', { density: 80, grain: 0.02, scatter: 24, harmonic: 0.2, noise: 0.1, focus: 10, attack: 0.3, release: 2 }],
    ['Breath', { density: 150, grain: 0.1, scatter: 5, harmonic: 0, noise: 0.95, focus: 2, attack: 1, release: 2.5 }],
    ['Granular choir', { density: 40, grain: 0.25, scatter: 7, harmonic: 1, noise: 0, attack: 1.5, release: 3 }],
    ['Static', { density: 300, grain: 0.005, scatter: 36, harmonic: 0, noise: 0.6, focus: 1, attack: 0.05, release: 0.5 }],
    ['Distant bells', { density: 6, grain: 0.4, scatter: 24, harmonic: 1, noise: 0, attack: 0.5, release: 4 }],
    ['Wind drone', { density: 120, grain: 0.3, scatter: 2, harmonic: 0, noise: 1, focus: 20, attack: 3, release: 5 }],
  ],
};

/** The factory presets of a module type, complete (every setting given) so loading one fully replaces the sound. */
export function factoryPresets(def: ModuleDef): Preset[] {
  const base = defaultParams(def);
  delete base.morph;
  return (FACTORY[def.type] ?? []).map(([name, params]) => ({ name, params: { ...base, ...params } }));
}

export function factoryTypes(): string[] {
  return Object.keys(FACTORY);
}

/**
 * Put a type's factory presets into its bank: each in its own slot if that
 * is empty, otherwise the next empty slot. Never overwrites the player's.
 */
export function seedBank(bank: readonly (Preset | null)[] | undefined, presets: Preset[]): (Preset | null)[] {
  const next = [...(bank ?? [])];
  while (next.length < PRESET_SLOTS) next.push(null);
  presets.forEach((p, i) => {
    if (next.some((x) => x?.name === p.name)) return;
    const slot = next[i] ? next.findIndex((x) => !x) : i;
    if (slot >= 0) next[slot] = p;
  });
  return next;
}

/** Fill the library with factory presets for every type not yet seeded. Returns the types it changed. */
export function seedLibrary(library: PresetLibrary, seeded: ReadonlySet<string>, defs: (t: string) => ModuleDef | undefined): { library: PresetLibrary; changed: string[] } {
  const next = { ...library };
  const changed: string[] = [];
  for (const type of factoryTypes()) {
    const def = defs(type);
    if (seeded.has(type) || !def) continue;
    next[type] = seedBank(library[type], factoryPresets(def));
    changed.push(type);
  }
  return { library: next, changed };
}
