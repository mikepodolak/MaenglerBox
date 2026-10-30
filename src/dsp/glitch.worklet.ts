import { GlitchCore, type GlitchSettings, type GlitchTrigger } from './glitch';

export type GlitchMessage = { type: 'settings'; settings: GlitchSettings } | { type: 'trigger'; trigger: GlitchTrigger } | { type: 'dispose' };

class GlitchProcessor extends AudioWorkletProcessor {
  private core = new GlitchCore(sampleRate);
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<GlitchMessage>) => {
      const msg = e.data;
      if (msg.type === 'settings') this.core.settings = { ...msg.settings };
      else if (msg.type === 'trigger') this.core.trigger(msg.trigger);
      else this.alive = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (out) this.core.process(inputs[0]?.[0], out, currentFrame);
    return this.alive;
  }
}

registerProcessor('mb-glitch', GlitchProcessor);
