// Minimal AudioWorkletGlobalScope typings; TypeScript's DOM lib doesn't ship them.
declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
