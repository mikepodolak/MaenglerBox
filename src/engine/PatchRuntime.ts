import type { EngineEnv, InputTarget, ModuleType, OutputSource, RuntimeModule } from '../modules/types';
import type { Cable, ModuleInstance, Patch } from '../patch/types';

interface LiveModule {
  instance: ModuleInstance;
  runtime: RuntimeModule;
}

/**
 * Keeps the live audio graph in step with a Patch.
 * Call `sync(patch)` after every edit: it adds and removes modules, pushes
 * changed params, and rewires only the cables that changed.
 */
export class PatchRuntime {
  private modules = new Map<string, LiveModule>();
  private cables = new Map<string, () => void>();

  constructor(
    private readonly env: EngineEnv,
    private readonly lookup: (type: string) => ModuleType | undefined,
  ) {}

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
        this.modules.set(instance.id, { instance, runtime: type.create(this.env, { ...instance.params }, instance.data) });
      } else if (live.instance !== instance) {
        for (const [k, v] of Object.entries(instance.params)) {
          if (live.instance.params[k] !== v) live.runtime.setParam(k, v);
        }
        if (live.instance.data !== instance.data) live.runtime.setData?.(instance.data);
        live.instance = instance;
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
    return connectPorts(src, dst);
  }
}

export function connectPorts(src: OutputSource, dst: InputTarget): (() => void) | null {
  if (src.kind === 'gate') {
    return dst.kind === 'gate' ? src.out.connect(dst.handler) : null;
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
  return null;
}

/** A module disposed earlier may already have dropped its connections. */
function safeDisconnect(fn: () => void): void {
  try {
    fn();
  } catch {
    // Already disconnected.
  }
}
