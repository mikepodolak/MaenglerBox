import type { EngineEnv, InputTarget, ModuleType, OutputSource, RuntimeModule } from '../modules/types';
import { DEFAULT_MOD_AMOUNT, modParam, modulatedValue } from '../patch/model';
import type { Cable, ModuleInstance, Patch, Preset, PresetLibrary } from '../patch/types';
import { gateToSignal, signalToGate } from './convert';
import { analyserProbes, type Probe, type ProbeFactory } from './modulation';

interface LiveModule {
  instance: ModuleInstance;
  runtime: RuntimeModule;
  presets: (Preset | null)[] | undefined;
  /** Settings currently moved by cables, and the value each was last given. */
  modded: Map<string, number>;
}

interface ModCable {
  cable: Cable;
  probe: Probe;
}

/**
 * Keeps the live audio graph in step with a Patch.
 * Call `sync(patch)` after every edit: it adds and removes modules, pushes
 * changed params, and rewires only the cables that changed.
 */
export class PatchRuntime {
  private modules = new Map<string, LiveModule>();
  private cables = new Map<string, () => void>();
  private library: PresetLibrary = {};
  /** Cables into settings, read and applied by `modulate()`. */
  private mods = new Map<string, ModCable>();
  private probe: ProbeFactory | null;

  constructor(
    private readonly env: EngineEnv,
    private readonly lookup: (type: string) => ModuleType | undefined,
    probe?: ProbeFactory,
  ) {
    this.probe = probe ?? (env.ctx ? analyserProbes(env.ctx) : null);
  }

  /** The shared preset banks. Modules whose presets live in the library read theirs from here. */
  setLibrary(library: PresetLibrary): void {
    this.library = library;
  }

  private presetsFor(instance: ModuleInstance, type: ModuleType): (Preset | null)[] | undefined {
    return (type.def.presetScope ?? 'library') === 'library' ? this.library[instance.type] : instance.presets;
  }

  sync(patch: Patch): void {
    const wantedModules = new Set(patch.modules.map((m) => m.id));
    const wantedCables = new Set(patch.cables.map((c) => c.id));

    for (const [id, undo] of this.cables) {
      if (!wantedCables.has(id)) {
        undo();
        this.cables.delete(id);
      }
    }
    for (const [id, live] of this.modules) {
      if (!wantedModules.has(id)) {
        live.runtime.dispose();
        this.modules.delete(id);
      }
    }

    for (const instance of patch.modules) {
      const live = this.modules.get(instance.id);
      if (!live) {
        const type = this.lookup(instance.type);
        if (!type) continue;
        const runtime = type.create(this.env, { ...instance.params }, instance.data);
        const presets = this.presetsFor(instance, type);
        if (presets) runtime.setPresets?.(presets);
        this.modules.set(instance.id, { instance, runtime, presets, modded: new Map() });
        continue;
      }
      if (live.instance !== instance) {
        for (const [k, v] of Object.entries(instance.params)) {
          // A modulated setting picks up its new base on the next modulate() instead.
          if (live.instance.params[k] !== v && !live.modded.has(k)) live.runtime.setParam(k, v);
        }
        if (live.instance.data !== instance.data) live.runtime.setData?.(instance.data);
        live.instance = instance;
      }
      const type = this.lookup(instance.type);
      const presets = type && this.presetsFor(instance, type);
      if (presets !== live.presets) {
        live.runtime.setPresets?.(presets ?? []);
        live.presets = presets;
      }
    }

    for (const cable of patch.cables) {
      if (!this.cables.has(cable.id)) {
        const undo = this.wire(cable);
        if (undo) this.cables.set(cable.id, undo);
      }
      const mod = this.mods.get(cable.id);
      if (mod) mod.cable = cable;
    }
  }

  /**
   * Read every cable patched into a setting and move those settings: the
   * patch keeps the slider's own value, and the signal times the cable's
   * amount is added on top. Settings no longer patched go back to their value.
   */
  modulate(): void {
    const sums = new Map<string, Map<string, number>>();
    for (const { cable, probe } of this.mods.values()) {
      const param = modParam(cable.to.port)!;
      let byParam = sums.get(cable.to.module);
      if (!byParam) sums.set(cable.to.module, (byParam = new Map()));
      byParam.set(param, (byParam.get(param) ?? 0) + probe.read() * (cable.amount ?? DEFAULT_MOD_AMOUNT));
    }
    for (const [id, live] of this.modules) {
      const byParam = sums.get(id);
      if (!byParam && !live.modded.size) continue;
      const params = this.lookup(live.instance.type)?.def.params ?? [];
      for (const [pid, last] of live.modded) {
        if (byParam?.has(pid)) continue;
        live.modded.delete(pid);
        const base = live.instance.params[pid];
        if (base !== last) live.runtime.setParam(pid, base);
      }
      for (const [pid, sum] of byParam ?? []) {
        const p = params.find((x) => x.id === pid);
        if (!p) continue;
        const v = modulatedValue(p, live.instance.params[pid], sum);
        if (live.modded.get(pid) === v) continue;
        live.modded.set(pid, v);
        live.runtime.setParam(pid, v);
      }
    }
  }

  get hasModulation(): boolean {
    return this.mods.size > 0;
  }

  /** The values cables are giving a module's settings right now, for moving sliders. */
  modValues(moduleId: string): ReadonlyMap<string, number> | undefined {
    const m = this.modules.get(moduleId)?.modded;
    return m?.size ? m : undefined;
  }

  getState(moduleId: string, now: number): unknown {
    return this.modules.get(moduleId)?.runtime.getState?.(now);
  }

  dispose(): void {
    for (const undo of this.cables.values()) undo();
    for (const live of this.modules.values()) live.runtime.dispose();
    this.cables.clear();
    this.mods.clear();
    this.modules.clear();
  }

  private wire(cable: Cable): (() => void) | null {
    if (modParam(cable.to.port) !== null) return this.wireMod(cable);
    const src = this.modules.get(cable.from.module)?.runtime.outputs[cable.from.port];
    const dst = this.modules.get(cable.to.module)?.runtime.inputs[cable.to.port];
    if (!src || !dst) return null;
    return connectPorts(src, dst, this.env.ctx);
  }

  private wireMod(cable: Cable): (() => void) | null {
    const src = this.modules.get(cable.from.module)?.runtime.outputs[cable.from.port];
    if (!src || !this.modules.has(cable.to.module) || !this.probe) return null;
    const probe = this.probe(src);
    if (!probe) return null;
    this.mods.set(cable.id, { cable, probe });
    return () => {
      probe.undo();
      this.mods.delete(cable.id);
    };
  }
}

/**
 * Wire an output to an input. Any output can feed any input, as in VCV Rack:
 * a gate into a CV input becomes a level that's high while the note is, and a
 * CV or audio signal into a gate input fires a gate each time it rises past 0.5.
 */
export function connectPorts(src: OutputSource, dst: InputTarget, ctx?: BaseAudioContext): (() => void) | null {
  if (src.kind === 'gate') {
    if (dst.kind === 'gate') return src.out.connect(dst.handler);
    if (!ctx) return null;
    const bridge = gateToSignal(ctx, src.out);
    const undo = connectPorts({ kind: 'node', node: bridge.node }, dst);
    return () => {
      undo?.();
      bridge.undo();
    };
  }
  const outIndex = src.index ?? 0;
  if (dst.kind === 'node') {
    const inIndex = dst.index ?? 0;
    src.node.connect(dst.node, outIndex, inIndex);
    return () => safeDisconnect(() => src.node.disconnect(dst.node, outIndex, inIndex));
  }
  if (dst.kind === 'param') {
    src.node.connect(dst.param, outIndex);
    return () => safeDisconnect(() => src.node.disconnect(dst.param, outIndex));
  }
  if (!ctx) return null;
  const bridge = signalToGate(ctx, dst.handler);
  src.node.connect(bridge.node, outIndex);
  return () => {
    safeDisconnect(() => src.node.disconnect(bridge.node, outIndex));
    bridge.undo();
  };
}

/** A module disposed earlier may already have dropped its connections. */
function safeDisconnect(fn: () => void): void {
  try {
    fn();
  } catch {
    // Already disconnected.
  }
}
