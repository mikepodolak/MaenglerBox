import { findModule, PatchError, type DefLookup } from './model';
import { fromNormalized, toNormalized } from './params';
import type { ModuleDef, ModuleInstance, Patch, Preset } from './types';

/** Slots per module, M8-style. */
export const PRESET_SLOTS = 16;

function updateModule(patch: Patch, moduleId: string, fn: (m: ModuleInstance) => ModuleInstance): Patch {
  findModule(patch, moduleId);
  return { ...patch, modules: patch.modules.map((m) => (m.id === moduleId ? fn(m) : m)), updatedAt: Date.now() };
}

function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PRESET_SLOTS) throw new PatchError(`No preset slot ${slot + 1}`);
}

/** True when a module type keeps its presets in the shared library rather than the patch. */
export function usesLibrary(def: ModuleDef | undefined): boolean {
  return (def?.presetScope ?? 'library') === 'library';
}

/** A preset holding the module's current settings. */
export function capturePreset(m: ModuleInstance, name: string): Preset {
  const preset: Preset = { name, params: { ...m.params } };
  if (m.data !== undefined) preset.data = m.data;
  return preset;
}

/** A copy of a bank with one slot replaced (null empties it). */
export function setSlot(bank: readonly (Preset | null)[] | undefined, slot: number, preset: Preset | null): (Preset | null)[] {
  checkSlot(slot);
  const next = [...(bank ?? [])];
  while (next.length < PRESET_SLOTS) next.push(null);
  next[slot] = preset;
  return next;
}

/** Store the module's current settings in one of its own (in-patch) slots. */
export function savePreset(patch: Patch, moduleId: string, slot: number, name?: string): Patch {
  checkSlot(slot);
  return updateModule(patch, moduleId, (m) => ({
    ...m,
    presets: setSlot(m.presets, slot, capturePreset(m, name ?? m.presets?.[slot]?.name ?? `Preset ${slot + 1}`)),
  }));
}

/** Load a slot of the module's own (in-patch) bank. Empty slots do nothing. */
export function recallPreset(patch: Patch, defs: DefLookup, moduleId: string, slot: number): Patch {
  checkSlot(slot);
  const preset = findModule(patch, moduleId).presets?.[slot];
  return preset ? applyPreset(patch, defs, moduleId, preset) : patch;
}

/** Load a preset's settings into a module, from any bank. */
export function applyPreset(patch: Patch, defs: DefLookup, moduleId: string, preset: Preset): Patch {
  const def = defs(findModule(patch, moduleId).type);
  return updateModule(patch, moduleId, (mod) => ({
    ...mod,
    params: { ...mod.params, ...presetParams(preset, mod.params) },
    data: def?.data && preset.data !== undefined ? def.data.normalize(preset.data) : mod.data,
  }));
}

export function clearPreset(patch: Patch, moduleId: string, slot: number): Patch {
  checkSlot(slot);
  return updateModule(patch, moduleId, (m) => ({ ...m, presets: setSlot(m.presets, slot, null) }));
}

export function renamePreset(patch: Patch, moduleId: string, slot: number, name: string): Patch {
  checkSlot(slot);
  return updateModule(patch, moduleId, (m) => {
    const presets = [...(m.presets ?? [])];
    const p = presets[slot];
    if (!p) return m;
    presets[slot] = { ...p, name: name.trim() || p.name };
    return { ...m, presets };
  });
}

/** Only params the module still has, so presets survive a module gaining or losing settings. */
function presetParams(preset: Preset, current: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(current)) if (typeof preset.params[k] === 'number') out[k] = preset.params[k];
  return out;
}

export function setLocked(patch: Patch, moduleId: string, paramId: string, locked: boolean): Patch {
  return updateModule(patch, moduleId, (m) => {
    const locks = new Set(m.locks ?? []);
    if (locked) locks.add(paramId);
    else locks.delete(paramId);
    return { ...m, locks: [...locks] };
  });
}

export interface RandomizeOptions {
  /**
   * 1 = fully random. Below 1 = mutate: each setting moves at most this far
   * (as a fraction of its range) from where it is.
   */
  amount: number;
  random?: () => number;
}

/** Randomize or mutate every unlocked param of a module. */
export function randomizeParams(patch: Patch, defs: DefLookup, moduleId: string, opts: RandomizeOptions): Patch {
  const m = findModule(patch, moduleId);
  const def = defs(m.type);
  if (!def) return patch;
  const rnd = opts.random ?? Math.random;
  const amount = Math.min(1, Math.max(0, opts.amount));
  const locks = new Set(m.locks ?? []);
  const params = { ...m.params };
  for (const p of def.params) {
    if (locks.has(p.id)) continue;
    if (p.options) {
      // Choices jump rather than drift: switch with a chance equal to the amount.
      if (rnd() < amount) params[p.id] = p.min + Math.floor(rnd() * p.options.length);
      continue;
    }
    const n = amount >= 1 ? rnd() : toNormalized(p, params[p.id]) + (rnd() * 2 - 1) * amount;
    params[p.id] = fromNormalized(p, n);
  }
  return updateModule(patch, moduleId, (mod) => ({ ...mod, params }));
}

/** Validate presets and locks loaded from storage. */
export function normalizePresets(raw: unknown, normalizeData?: (d: unknown) => unknown): (Preset | null)[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, PRESET_SLOTS).map((p) => {
    if (typeof p !== 'object' || p === null) return null;
    const r = p as Partial<Preset>;
    if (typeof r.params !== 'object' || r.params === null) return null;
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.params)) if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
    const preset: Preset = { name: typeof r.name === 'string' ? r.name.slice(0, 40) : 'Preset', params };
    // Without a normalizer the data is kept as is; applyPreset normalizes it on load.
    if (r.data !== undefined) preset.data = normalizeData ? normalizeData(r.data) : r.data;
    return preset;
  });
}
