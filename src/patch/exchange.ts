import { deserializePatch, newId, type DefLookup } from './model';
import { normalizePresets, PRESET_SLOTS, usesLibrary } from './presets';
import type { Patch, Preset, PresetLibrary } from './types';

/** Marks a file as a MaenglerBox patch. */
export const PATCH_FILE_FORMAT = 'maenglerbox-patch';
export const PATCH_FILE_EXT = '.maengler.json';

export interface PatchFile {
  format: typeof PATCH_FILE_FORMAT;
  version: 1;
  patch: Patch;
  /** The shared presets of the patch's synths, so steps that call up a preset sound the same elsewhere. */
  library: PresetLibrary;
}

/** The file for a patch: the patch and the library presets its modules use. */
export function exportPatch(patch: Patch, library: PresetLibrary, defs: DefLookup): PatchFile {
  const types = new Set(patch.modules.filter((m) => usesLibrary(defs(m.type)) && defs(m.type)?.presets).map((m) => m.type));
  const used: PresetLibrary = {};
  for (const t of types) if (library[t]?.some(Boolean)) used[t] = library[t];
  return { format: PATCH_FILE_FORMAT, version: 1, patch, library: used };
}

/** Read a patch file, or throw if it isn't one. A bare patch (no wrapper) is accepted too. */
export function parsePatchFile(json: unknown, defs: DefLookup): { patch: Patch; library: PresetLibrary } {
  if (typeof json !== 'object' || json === null) throw new Error('This is not a MaenglerBox patch file.');
  const r = json as Partial<PatchFile> & { modules?: unknown };
  const raw = r.format === PATCH_FILE_FORMAT ? r.patch : Array.isArray(r.modules) ? json : null;
  if (!raw) throw new Error('This is not a MaenglerBox patch file.');
  const patch = deserializePatch(raw, defs);
  const library: PresetLibrary = {};
  if (r.format === PATCH_FILE_FORMAT && typeof r.library === 'object' && r.library !== null) {
    for (const [type, bank] of Object.entries(r.library)) {
      const def = defs(type);
      if (!def) continue;
      const presets = normalizePresets(bank, def.data?.normalize);
      if (presets) library[type] = presets;
    }
  }
  return { patch, library };
}

/**
 * Add a file's presets to the library. Empty slots take the file's preset;
 * a slot that already holds a different preset keeps it, and is counted as skipped.
 */
export function mergeLibrary(
  library: PresetLibrary,
  incoming: PresetLibrary,
): { library: PresetLibrary; changed: string[]; added: number; skipped: number } {
  const next = { ...library };
  const changed: string[] = [];
  let added = 0;
  let skipped = 0;
  for (const [type, bank] of Object.entries(incoming)) {
    const mine = [...(library[type] ?? [])];
    while (mine.length < PRESET_SLOTS) mine.push(null);
    let touched = false;
    bank.forEach((p, i) => {
      if (!p) return;
      const have = mine[i];
      if (!have) {
        mine[i] = p;
        added++;
        touched = true;
      } else if (!samePreset(have, p)) skipped++;
    });
    if (touched) {
      next[type] = mine;
      changed.push(type);
    }
  }
  return { library: next, changed, added, skipped };
}

function samePreset(a: Preset, b: Preset): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A patch to store as a separate copy, when the device already has one with the same id. */
export function asCopy(patch: Patch): Patch {
  return { ...patch, id: newId('patch'), name: `${patch.name} (copy)`, updatedAt: Date.now() };
}
