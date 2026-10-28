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
  create(env: EngineEnv, params: Record<string, number>): RuntimeModule;
}

/** Glide parameter changes a little so slider moves don't click. */
export function smoothSet(param: AudioParam, value: number, ctx: BaseAudioContext, tau = 0.01): void {
  param.cancelScheduledValues(ctx.currentTime);
  param.setTargetAtTime(value, ctx.currentTime, tau);
}
