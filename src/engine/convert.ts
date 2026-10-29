import type { TriggerMessage } from '../dsp/trigger.worklet';
import triggerWorkletUrl from '../dsp/trigger.worklet.ts?worker&url';
import type { GateHandler, GateOutput } from './gate';

/** Worklet the engine loads so CV and audio cables can play gate inputs. */
export const CONVERT_WORKLETS = [triggerWorkletUrl];

/** How long a gate made from a CV edge stays high; the edge doesn't say when it will fall. */
export const EDGE_GATE_LENGTH = 0.05;
/** Edges arrive from the audio thread just after they happen; play them this much later, evenly. */
const EDGE_LATENCY = 0.01;

/**
 * Gate into a CV input: the cable carries the gate as a level, high at the
 * note's velocity for its length, then back to 0. A clock into a VCA makes
 * clicks; a sequencer into a VCA opens it for each note.
 */
export function gateToSignal(ctx: BaseAudioContext, out: GateOutput): { node: AudioNode; undo: () => void } {
  const src = ctx.createConstantSource();
  src.offset.value = 0;
  src.start();
  const off = out.connect((e) => {
    src.offset.setValueAtTime(e.value, e.time);
    src.offset.setValueAtTime(0, e.time + Math.max(0.001, e.length));
  });
  return {
    node: src,
    undo: () => {
      off();
      src.stop();
      src.disconnect();
    },
  };
}

/**
 * CV or audio into a gate input: each time the signal rises past 0.5 it fires
 * a short gate, like a Schmitt trigger on a hardware gate input.
 */
export function signalToGate(ctx: BaseAudioContext, handler: GateHandler): { node: AudioNode; undo: () => void } {
  const detector = new AudioWorkletNode(ctx, 'mb-trigger', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  // The detector outputs silence; it only has to sit in the graph so the browser keeps running it.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  detector.connect(sink).connect(ctx.destination);
  detector.port.onmessage = (e: MessageEvent<TriggerMessage>) => {
    const time = Math.max(e.data.time, ctx.currentTime) + EDGE_LATENCY;
    handler({ time, value: e.data.value, length: EDGE_GATE_LENGTH });
  };
  return {
    node: detector,
    undo: () => {
      detector.port.onmessage = null;
      detector.disconnect();
      sink.disconnect();
    },
  };
}
