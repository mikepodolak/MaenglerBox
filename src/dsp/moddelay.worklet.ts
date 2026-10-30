import { ModDelayCore, type ModDelayEvent, type ModDelaySettings } from './moddelay';

export type ModDelayMessage = { type: 'settings'; settings: ModDelaySettings } | { type: 'event'; event: ModDelayEvent } | { type: 'dispose' };

class ModDelayProcessor extends AudioWorkletProcessor {
  private core = new ModDelayCore(sampleRate);
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ModDelayMessage>) => {
      const msg = e.data;
      if (msg.type === 'settings') this.core.settings = { ...msg.settings };
      else if (msg.type === 'event') this.core.schedule(msg.event);
      else this.alive = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (out) this.core.process(inputs[0]?.[0], out, currentFrame);
    return this.alive;
  }
}

registerProcessor('mb-moddelay', ModDelayProcessor);
