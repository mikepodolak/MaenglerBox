import type { ModuleDef } from '../patch/types';
import { clock, envelope, oscillator, output, vca } from './core';
import { fmVoice } from './fmVoice';
import { sequencer } from './sequencer';
import type { ModuleType } from './types';

const types = new Map<string, ModuleType>();

export function register(t: ModuleType): void {
  types.set(t.def.type, t);
}

for (const t of [clock, sequencer, fmVoice, oscillator, envelope, vca, output]) register(t);

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
