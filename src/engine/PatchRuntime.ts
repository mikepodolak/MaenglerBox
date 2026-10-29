import type { EngineEnv, InputTarget, ModuleType, OutputSource, RuntimeModule } from '../modules/types';
import type { Cable, ModuleInstance, Patch, Preset, PresetLibrary } from '../patch/types';
import { gateToSignal, signalToGate } from './convert';

interface LiveModule {
  instance: ModuleInstance;
  runtime: RuntimeModule;
  presets: (Preset | null)[] | undefined;
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

  constructor(
    private readonly env: EngineEnv,
    private readonly lookup: (type: string) => ModuleType | undefined,
  ) {}

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
        this.modules.set(instance.id, { instance, runtime, presets });
        continue;
      }
      if (live.instance !== instance) {
        for (const [k, v] of Object.entries(instance.params)) {
          if (live.instance.params[k] !== v) live.runtime.setParam(k, v);
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
    }
  }

  getState(moduleId: string, now: number): unknown {
    return this.modules.get(moduleId)?.runtime.getState?.(now);
  }

  dispose(): void {
    for (const undo of this.cables.values()) undo();
    for (const live of this.modules.values()) live.runtime.dispose();
    this.cables.clear();
    this.modules.clear();
  }

  private wire(cable: Cable): (() => void) | null {
    const src = this.modules.get(cable.from.module)?.runtime.outputs[cable.from.port];
    const dst = this.modules.get(cable.to.module)?.runtime.inputs[cable.to.port];
    if (!src || !dst) return null;
    return connectPorts(src, dst, this.env.ctx);
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
