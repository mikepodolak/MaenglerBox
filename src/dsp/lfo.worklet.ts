import { LfoCore, type LfoEvent, type LfoSettings } from './lfo';

export type LfoMessage = { type: 'settings'; settings: LfoSettings } | { type: 'event'; event: LfoEvent } | { type: 'dispose' };

/** Where the LFO is in its cycle, posted a few dozen times a second for the card's drawing. */
export interface LfoReport {
  time: number;
  phase: number;
}

const REPORT_FRAMES = 1024;

class LfoProcessor extends AudioWorkletProcessor {
  private lfo = new LfoCore(sampleRate);
  private alive = true;
  private sinceReport = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<LfoMessage>) => {
      const msg = e.data;
      if (msg.type === 'settings') this.lfo.settings = { ...msg.settings };
      else if (msg.type === 'event') this.lfo.schedule(msg.event);
      else this.alive = false;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (out) {
      this.lfo.process(out, currentFrame);
      this.sinceReport += out.length;
      if (this.sinceReport >= REPORT_FRAMES) {
        this.sinceReport = 0;
        this.port.postMessage({ time: currentTime, phase: this.lfo.phase } satisfies LfoReport);
      }
    }
    return this.alive;
  }
}

registerProcessor('mb-lfo', LfoProcessor);
