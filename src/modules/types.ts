import type { GateHandler, GateOutput } from '../engine/gate';
import type { Scheduler } from '../engine/Scheduler';
import type { ModuleDef } from '../patch/types';

/** Where a cable lands on a module's input. */
export type InputTarget =
  | { kind: 'node'; node: AudioNode; index?: number }
  | { kind: 'param'; param: AudioParam }
  | { kind: 'gate'; handler: GateHandler };

/** Where a cable leaves a module's output. */
export type OutputSource = { kind: 'node'; node: AudioNode; index?: number } | { kind: 'gate'; out: GateOutput };

/** A live module in the audio graph. */
export interface RuntimeModule {
  inputs: Record<string, InputTarget>;
  outputs: Record<string, OutputSource>;
  setParam(id: string, value: number): void;
  /** Receives the module's structured data whenever it changes. */
  setData?(data: unknown): void;
  /** Live state for the UI (like a sequencer's playhead) as of audio time `now`. */
  getState?(now: number): unknown;
  dispose(): void;
}

export interface EngineEnv {
  ctx: BaseAudioContext;
  scheduler: Scheduler;
  /** Final bus before the speakers. Output modules connect here. */
  master: AudioNode;
}

export interface ModuleType {
  def: ModuleDef;
  /** AudioWorklet scripts that must be loaded before `create` runs. */
  worklets?: string[];
  create(env: EngineEnv, params: Record<string, number>, data: unknown): RuntimeModule;
}

/** Glide parameter changes a little so slider moves don't click. */
export function smoothSet(param: AudioParam, value: number, ctx: BaseAudioContext, tau = 0.01): void {
  param.cancelScheduledValues(ctx.currentTime);
  param.setTargetAtTime(value, ctx.currentTime, tau);
}
