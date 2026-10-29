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
export function analyserProbes(ctx: BaseAudioContext): ProbeFactory {
  let sink: GainNode | null = null;
  return (src) => {
    if (!sink) {
      sink = ctx.createGain();
      sink.gain.value = 0;
      sink.connect(ctx.destination);
    }
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
