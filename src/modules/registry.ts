import { MORPH, morphParam, usesLibrary } from '../patch/presets';
import type { ModuleDef } from '../patch/types';
import { clock, envelope, oscillator, output, vca } from './core';
import { balls } from './balls';
import { conductor } from './conductor';
import { fmVoice } from './fmVoice';
import { comb, delay, flanger, glitch, phaser, reverb, ringMod } from './fx';
import { fmDrum, fmLead, pad, pluck, texture } from './voices';
import { chanceGate, euclid, probability, sampleHold, turing } from './generative';
import { lfo } from './lfo';
import { life } from './life';
import { markov } from './markov';
import { matrix } from './matrix';
import { eq, filter, light, meter, mixer } from './mixing';
import { multiTracker } from './multiTracker';
import { sequencer } from './sequencer';
import type { ModuleType } from './types';

const types = new Map<string, ModuleType>();

export function register(t: ModuleType): void {
  // Instruments with a preset library can blend between two of their presets.
  if (t.def.presets && usesLibrary(t.def) && !t.def.params.some((p) => p.id === MORPH)) t.def.params = [...t.def.params, morphParam];
  types.set(t.def.type, t);
}

for (const t of [
  clock, sequencer, multiTracker, euclid, turing,
  chanceGate, probability, markov, matrix, balls, life,
  fmVoice, fmDrum, fmLead, pad, pluck, texture, oscillator,
  delay, reverb, phaser, flanger, comb, ringMod, glitch,
  envelope, lfo, sampleHold,
  filter, eq,
  vca, mixer, meter, light, conductor, output,
]) register(t);

/** Every worklet script any module needs, loaded once when audio starts. */
export function allWorklets(): string[] {
  return [...new Set([...types.values()].flatMap((t) => t.worklets ?? []))];
}

export function getModuleType(type: string): ModuleType | undefined {
  return types.get(type);
}

export function getDef(type: string): ModuleDef | undefined {
  return types.get(type)?.def;
}

export function allDefs(): ModuleDef[] {
  return [...types.values()].map((t) => t.def);
}
