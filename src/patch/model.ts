import { fromNormalized, toNormalized } from './params';
import { normalizePresets } from './presets';
import type { Cable, ModuleDef, ModuleInstance, ParamDef, Patch, PortDef, PortKind, PortRef } from './types';

/** Lookup for module definitions; the patch model never touches audio. */
export type DefLookup = (type: string) => ModuleDef | undefined;

export class PatchError extends Error {}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createPatch(name = 'Untitled'): Patch {
  return { version: 1, id: newId('patch'), name, modules: [], cables: [], updatedAt: Date.now() };
}

function touch(patch: Patch, changes: Partial<Patch>): Patch {
  return { ...patch, ...changes, updatedAt: Date.now() };
}

export function defaultParams(def: ModuleDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.id, p.default]));
}

export function addModule(patch: Patch, def: ModuleDef, x = 0, y = 0, id = newId(def.type)): [Patch, ModuleInstance] {
  const mod: ModuleInstance = { id, type: def.type, x, y, params: defaultParams(def) };
  if (def.data) mod.data = def.data.create();
  return [touch(patch, { modules: [...patch.modules, mod] }), mod];
}

export function removeModule(patch: Patch, moduleId: string): Patch {
  return touch(patch, {
    modules: patch.modules.filter((m) => m.id !== moduleId),
    cables: patch.cables.filter((c) => c.from.module !== moduleId && c.to.module !== moduleId),
  });
}

export function moveModule(patch: Patch, moduleId: string, x: number, y: number): Patch {
  return touch(patch, { modules: patch.modules.map((m) => (m.id === moduleId ? { ...m, x, y } : m)) });
}

/** Card widths a resizable module can take. */
export const MIN_CARD_WIDTH = 160;
export const MAX_CARD_WIDTH = 640;

export function resizeModule(patch: Patch, moduleId: string, width: number): Patch {
  const w = Math.round(Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, width)));
  return touch(patch, { modules: patch.modules.map((m) => (m.id === moduleId ? { ...m, width: w } : m)) });
}

export function setParam(patch: Patch, defs: DefLookup, moduleId: string, paramId: string, value: number): Patch {
  const mod = findModule(patch, moduleId);
  const param = defs(mod.type)?.params.find((p) => p.id === paramId);
  if (!param) throw new PatchError(`Unknown param ${paramId} on ${mod.type}`);
  const clamped = Math.min(param.max, Math.max(param.min, value));
  return touch(patch, {
    modules: patch.modules.map((m) => (m.id === moduleId ? { ...m, params: { ...m.params, [paramId]: clamped } } : m)),
  });
}

export function setModuleData(patch: Patch, defs: DefLookup, moduleId: string, data: unknown): Patch {
  const mod = findModule(patch, moduleId);
  const dataDef = defs(mod.type)?.data;
  if (!dataDef) throw new PatchError(`${mod.type} has no data`);
  const clean = dataDef.normalize(data);
  return touch(patch, { modules: patch.modules.map((m) => (m.id === moduleId ? { ...m, data: clean } : m)) });
}

/**
 * Which output kinds may feed which input kinds. Like VCV Rack, any output can
 * go into any input: the engine converts between gates and signals (a gate
 * becomes a level; a rising signal fires a gate).
 */
export function canConnect(_from: PortKind, _to: PortKind): boolean {
  return true;
}

/**
 * Every setting can take a cable. Its input port is the param id with this
 * prefix ('@ratio'), so settings cables live alongside ordinary ones.
 */
export const MOD_PREFIX = '@';
export const DEFAULT_MOD_AMOUNT = 0.3;

export function modPort(paramId: string): string {
  return MOD_PREFIX + paramId;
}

/** The param a settings port modulates, or null for an ordinary input. */
export function modParam(port: string): string | null {
  return port.startsWith(MOD_PREFIX) ? port.slice(MOD_PREFIX.length) : null;
}

/** The input port for a settings jack, so it can be drawn and patched like any other. */
export function modPortDef(p: ParamDef): PortDef {
  return { id: modPort(p.id), label: p.label, kind: 'cv' };
}

/**
 * A setting's value under modulation: `sum` is the signal times each cable's
 * amount, added along the slider's travel (so exponential sliders like Ratio
 * sweep evenly), then clamped and snapped like a slider move.
 */
export function modulatedValue(p: ParamDef, base: number, sum: number): number {
  return fromNormalized(p, toNormalized(p, base) + sum);
}

/** Give a setting a jack on its card. */
export function exposeParam(patch: Patch, defs: DefLookup, moduleId: string, paramId: string): Patch {
  const mod = findModule(patch, moduleId);
  if (!defs(mod.type)?.params.some((p) => p.id === paramId)) throw new PatchError(`Unknown param ${paramId} on ${mod.type}`);
  if (mod.modJacks?.includes(paramId)) return patch;
  return touch(patch, {
    modules: patch.modules.map((m) => (m.id === moduleId ? { ...m, modJacks: [...(m.modJacks ?? []), paramId] } : m)),
  });
}

/** Take a setting's jack off its card, unplugging whatever was patched into it. */
export function hideParam(patch: Patch, moduleId: string, paramId: string): Patch {
  const port = modPort(paramId);
  return touch(patch, {
    modules: patch.modules.map((m) => {
      if (m.id !== moduleId) return m;
      const modJacks = (m.modJacks ?? []).filter((id) => id !== paramId);
      const { modJacks: _, ...rest } = m;
      return modJacks.length ? { ...rest, modJacks } : rest;
    }),
    cables: patch.cables.filter((c) => !(c.to.module === moduleId && c.to.port === port)),
  });
}

export function setCableAmount(patch: Patch, cableId: string, amount: number): Patch {
  const a = Math.min(1, Math.max(-1, amount));
  return touch(patch, { cables: patch.cables.map((c) => (c.id === cableId ? { ...c, amount: a } : c)) });
}

export function connect(patch: Patch, defs: DefLookup, from: PortRef, to: PortRef): [Patch, Cable] {
  const out = findPort(patch, defs, from, 'outputs');
  const inp = findPort(patch, defs, to, 'inputs');
  if (!canConnect(out.kind, inp.kind)) {
    throw new PatchError(`Can't connect ${out.kind} output to ${inp.kind} input`);
  }
  if (from.module === to.module) throw new PatchError("Can't connect a module to itself");
  const existing = patch.cables.find((c) => samePort(c.from, from) && samePort(c.to, to));
  if (existing) return [patch, existing];
  const cable: Cable = { id: newId('cable'), from: { ...from }, to: { ...to } };
  const param = modParam(to.port);
  if (param === null) return [touch(patch, { cables: [...patch.cables, cable] }), cable];
  // A cable dropped on a setting gives that setting a jack, so the cable has somewhere to plug in.
  cable.amount = DEFAULT_MOD_AMOUNT;
  const exposed = exposeParam(patch, defs, to.module, param);
  return [touch(exposed, { cables: [...exposed.cables, cable] }), cable];
}

export function disconnect(patch: Patch, cableId: string): Patch {
  return touch(patch, { cables: patch.cables.filter((c) => c.id !== cableId) });
}

export function findModule(patch: Patch, moduleId: string): ModuleInstance {
  const mod = patch.modules.find((m) => m.id === moduleId);
  if (!mod) throw new PatchError(`No module ${moduleId}`);
  return mod;
}

function findPort(patch: Patch, defs: DefLookup, ref: PortRef, side: 'inputs' | 'outputs'): PortDef {
  const mod = findModule(patch, ref.module);
  const def = defs(mod.type);
  if (!def) throw new PatchError(`Unknown module type ${mod.type}`);
  const param = side === 'inputs' ? modParam(ref.port) : null;
  if (param !== null) {
    const p = def.params.find((x) => x.id === param);
    if (!p) throw new PatchError(`${mod.type} has no setting ${param}`);
    return modPortDef(p);
  }
  const port = def[side].find((p) => p.id === ref.port);
  if (!port) throw new PatchError(`${mod.type} has no ${side === 'inputs' ? 'input' : 'output'} ${ref.port}`);
  return port;
}

function samePort(a: PortRef, b: PortRef): boolean {
  return a.module === b.module && a.port === b.port;
}

/**
 * Parse untrusted JSON (from storage or a shared file) into a Patch.
 * Unknown module types and dangling cables are dropped rather than failing the whole load,
 * and missing params are filled from their defaults.
 */
export function deserializePatch(json: unknown, defs: DefLookup): Patch {
  if (!isObject(json) || json.version !== 1 || !Array.isArray(json.modules) || !Array.isArray(json.cables)) {
    throw new PatchError('Not a MaenglerBox patch');
  }
  const modules: ModuleInstance[] = [];
  for (const m of json.modules) {
    if (!isObject(m) || typeof m.id !== 'string' || typeof m.type !== 'string') continue;
    const def = defs(m.type);
    if (!def) continue;
    const params = defaultParams(def);
    if (isObject(m.params)) {
      for (const p of def.params) {
        const v = m.params[p.id];
        if (typeof v === 'number' && Number.isFinite(v)) params[p.id] = Math.min(p.max, Math.max(p.min, v));
      }
    }
    const mod: ModuleInstance = { id: m.id, type: m.type, x: num(m.x), y: num(m.y), params };
    if (def.data) mod.data = def.data.normalize(m.data);
    const presets = normalizePresets(m.presets, def.data?.normalize);
    if (presets) mod.presets = presets;
    if (typeof m.width === 'number' && Number.isFinite(m.width)) mod.width = Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, m.width));
    if (Array.isArray(m.modJacks)) {
      const jacks = [...new Set(m.modJacks.filter((id): id is string => typeof id === 'string' && id in params))];
      if (jacks.length) mod.modJacks = jacks;
    }
    if (Array.isArray(m.locks)) mod.locks = m.locks.filter((id): id is string => typeof id === 'string' && id in params);
    modules.push(mod);
  }
  let patch: Patch = {
    version: 1,
    id: typeof json.id === 'string' ? json.id : newId('patch'),
    name: typeof json.name === 'string' ? json.name : 'Untitled',
    modules,
    cables: [],
    updatedAt: num(json.updatedAt) || Date.now(),
  };
  for (const c of json.cables) {
    if (!isObject(c) || !isPortRef(c.from) || !isPortRef(c.to)) continue;
    try {
      let cable: Cable;
      [patch, cable] = connect(patch, defs, c.from, c.to);
      if (cable.amount !== undefined && typeof c.amount === 'number' && Number.isFinite(c.amount)) {
        patch = setCableAmount(patch, cable.id, c.amount);
      }
    } catch {
      // Dangling or invalid cable: skip it.
    }
  }
  return patch;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPortRef(v: unknown): v is PortRef {
  return isObject(v) && typeof v.module === 'string' && typeof v.port === 'string';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
