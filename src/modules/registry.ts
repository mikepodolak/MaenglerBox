import type { ModuleDef } from '../patch/types';
import { clock, envelope, oscillator, output, vca } from './core';
import type { ModuleType } from './types';

const types = new Map<string, ModuleType>();

export function register(t: ModuleType): void {
  types.set(t.def.type, t);
}

for (const t of [output, oscillator, vca, envelope, clock]) register(t);

export function getModuleType(type: string): ModuleType | undefined {
  return types.get(type);
}

export function getDef(type: string): ModuleDef | undefined {
  return types.get(type)?.def;
}

export function allDefs(): ModuleDef[] {
  return [...types.values()].map((t) => t.def);
}
