import type { OutputSource } from '../modules/types';
import { gateToSignal } from './convert';

/** Reads the current level of a module output from the main thread. */
export interface Probe {
  read(): number;
  undo(): void;
}

export type ProbeFactory = (src: OutputSource) => Probe | null;

/** How often cables into settings are read and applied. */
export const MOD_RATE_HZ = 60;

/**
 * Probes read an output through a tiny analyser. Gates go through the same
 * bridge as a gate into a CV input, so a note reads as its velocity while it
 * plays. The analysers feed a silent sink so the browser keeps them running.
 */
const sinks = new WeakMap<BaseAudioContext, GainNode>();

/** A muted path to the speakers. Analysers connected here keep running without being heard. */
export function silentSink(ctx: BaseAudioContext): GainNode {
  let sink = sinks.get(ctx);
  if (!sink) {
    sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    sinks.set(ctx, sink);
  }
  return sink;
}

/** Peak and RMS of what's flowing through a node right now, for meters and lights. */
export function levelTap(ctx: BaseAudioContext, node: AudioNode, output = 0): { read(): { peak: number; rms: number }; dispose(): void } {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const buf = new Float32Array(analyser.fftSize);
  node.connect(analyser, output);
  analyser.connect(silentSink(ctx));
  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      let sum = 0;
      for (const v of buf) {
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v;
      }
      return { peak, rms: Math.sqrt(sum / buf.length) };
    },
    dispose() {
      analyser.disconnect();
    },
  };
}

export function analyserProbes(ctx: BaseAudioContext): ProbeFactory {
  return (src) => {
    const sink = silentSink(ctx);
    const bridge = src.kind === 'gate' ? gateToSignal(ctx, src.out) : null;
    const node = bridge ? bridge.node : (src as { node: AudioNode }).node;
    const index = src.kind === 'node' ? (src.index ?? 0) : 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32;
    const buf = new Float32Array(analyser.fftSize);
    node.connect(analyser, index);
    analyser.connect(sink);
    return {
      read() {
        analyser.getFloatTimeDomainData(buf);
        const v = buf[buf.length - 1];
        return Number.isFinite(v) ? v : 0;
      },
      undo() {
        try {
          node.disconnect(analyser, index);
        } catch {
          // Its module already went away.
        }
        analyser.disconnect();
        bridge?.undo();
      },
    };
  };
}
