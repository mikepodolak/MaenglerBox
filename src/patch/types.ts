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
}

/** Static description of a module type: what it's called and what it exposes. */
export interface ModuleDef {
  type: string;
  label: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
}

export interface ModuleInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Record<string, number>;
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
