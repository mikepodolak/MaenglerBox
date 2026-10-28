import type { Cable, ModuleDef, ModuleInstance, Patch, PortDef, PortKind, PortRef } from './types';

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

/** Which output kinds may feed which input kinds. Audio and CV are interchangeable signals. */
export function canConnect(from: PortKind, to: PortKind): boolean {
  if (from === 'gate' || to === 'gate') return from === to;
  return true;
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
  return [touch(patch, { cables: [...patch.cables, cable] }), cable];
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
      [patch] = connect(patch, defs, c.from, c.to);
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
