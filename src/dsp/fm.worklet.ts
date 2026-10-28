import { FMSynth, type FMParams, type NoteEvent } from './fm';

export type FMMessage =
  | { type: 'params'; params: FMParams }
  | { type: 'note'; event: NoteEvent }
  | { type: 'allOff' }
  | { type: 'dispose' };

class FMProcessor extends AudioWorkletProcessor {
  private synth = new FMSynth(sampleRate);
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<FMMessage>) => {
      const msg = e.data;
      if (msg.type === 'params') this.synth.params = msg.params;
      else if (msg.type === 'note') this.synth.schedule(msg.event);
      else if (msg.type === 'allOff') this.synth.allOff();
      else if (msg.type === 'dispose') this.alive = false;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, ...rest] = outputs[0];
    if (left) {
      this.synth.process(left, currentFrame);
      for (const ch of rest) ch.set(left);
    }
    return this.alive;
  }
}

registerProcessor('mb-fm', FMProcessor);
