/**
 * Signal kinds a port can carry.
 * - audio: audio-rate signal (an AudioNode output)
 * - cv:    control signal that modulates a parameter (also audio-rate under the hood)
 * - gate:  sample-accurate timed events (triggers, notes) scheduled ahead of time
 */
export type PortKind = 'audio' | 'cv' | 'gate';

export interface PortDef {
  id: string;
  label: string;
  kind: PortKind;
}

export interface ParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  unit?: string;
  /** 'exp' maps a 0..1 control to the range exponentially (frequencies, times). */
  curve?: 'lin' | 'exp';
  /** Names for each integer value, for choice params like a waveform or scale. */
  options?: string[];
}

/**
 * Structured per-module state that doesn't fit in numeric params,
 * like a sequencer's steps. Stored in the patch as plain JSON.
 */
export interface ModuleDataDef<T = unknown> {
  create(): T;
  /** Turn untrusted JSON back into valid data, repairing what it can. */
  normalize(raw: unknown): T;
}

/** Static description of a module type: what it's called and what it exposes. */
export interface ModuleDef {
  type: string;
  label: string;
  /** One-line description shown in the module picker. */
  description?: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** Params shown on the module's face in the canvas. The inspector shows them all. */
  face?: string[];
  /** Optional named groups for the inspector, in order. Params not listed go in a trailing group. */
  groups?: { label: string; params: string[] }[];
  data?: ModuleDataDef;
}

export interface ModuleInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Record<string, number>;
  data?: unknown;
  /** Saved snapshots of params (and data). Sparse: empty slots are null. */
  presets?: (Preset | null)[];
  /** Param ids that randomize and mutate leave alone. */
  locks?: string[];
}

export interface Preset {
  name: string;
  params: Record<string, number>;
  data?: unknown;
}

export interface PortRef {
  module: string;
  port: string;
}

export interface Cable {
  id: string;
  from: PortRef;
  to: PortRef;
}

export interface Patch {
  version: 1;
  id: string;
  name: string;
  modules: ModuleInstance[];
  cables: Cable[];
  updatedAt: number;
}
