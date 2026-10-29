import { TriggerDetector } from './trigger';

export interface TriggerMessage {
  /** Audio-clock time of the rising edge. */
  time: number;
  value: number;
}

/** Watches a CV or audio input and posts each rising edge, so it can play a gate input. */
class TriggerProcessor extends AudioWorkletProcessor {
  private detector = new TriggerDetector();

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch) {
      for (const t of this.detector.process(ch, currentFrame)) {
        this.port.postMessage({ time: t.frame / sampleRate, value: t.value } satisfies TriggerMessage);
      }
    }
    return true;
  }
}

registerProcessor('mb-trigger', TriggerProcessor);
