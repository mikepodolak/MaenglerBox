import type { ModuleDef } from '../patch/types';
import { clock, envelope, oscillator, output, vca } from './core';
import { balls } from './balls';
import { fmVoice } from './fmVoice';
import { fmLead, pluck } from './voices';
import { chanceGate, euclid, probability, sampleHold, turing } from './generative';
import { lfo } from './lfo';
import { life } from './life';
import { markov } from './markov';
import { eq, filter, light, meter, mixer } from './mixing';
import { multiTracker } from './multiTracker';
import { sequencer } from './sequencer';
import type { ModuleType } from './types';

const types = new Map<string, ModuleType>();

export function register(t: ModuleType): void {
  types.set(t.def.type, t);
}

for (const t of [
  clock, sequencer, multiTracker, euclid, turing,
  chanceGate, probability, markov, balls, life,
  fmVoice, fmLead, pluck, oscillator,
  envelope, lfo, sampleHold,
  filter, eq,
  vca, mixer, meter, light, output,
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
