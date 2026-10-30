import { defaultDrumParams, DrumVoice, type DrumParams } from './drum';
import { defaultLeadParams, LeadVoice, type LeadParams } from './lead';
import { defaultPadParams, PadVoice, type PadParams } from './pad';
import { defaultPluckParams, PluckVoice, type PluckParams } from './pluck';
import { PolySynth, type PolyNote } from './poly';
import { defaultTextureParams, TextureVoice, type TextureParams } from './texture';

export type VoiceMessage<P> = { type: 'params'; params: P } | { type: 'note'; event: PolyNote<P> } | { type: 'allOff' } | { type: 'dispose' };

/** One processor per synth type, sharing the note scheduling and message handling. */
function voiceProcessor<P extends { level: number }>(make: () => PolySynth<P>) {
  return class extends AudioWorkletProcessor {
    private synth = make();
    private alive = true;

    constructor() {
      super();
      this.port.onmessage = (e: MessageEvent<VoiceMessage<P>>) => {
        const msg = e.data;
        if (msg.type === 'params') this.synth.params = msg.params;
        else if (msg.type === 'note') this.synth.schedule(msg.event);
        else if (msg.type === 'allOff') this.synth.allOff();
        else this.alive = false;
      };
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const [first, ...rest] = outputs[0];
      if (first) {
        this.synth.process(first, currentFrame, this.synth.params.level * 0.5);
        for (const ch of rest) ch.set(first);
      }
      return this.alive;
    }
  };
}

registerProcessor('mb-lead', voiceProcessor<LeadParams>(() => new PolySynth(sampleRate, defaultLeadParams(), () => new LeadVoice())));
registerProcessor('mb-pluck', voiceProcessor<PluckParams>(() => new PolySynth(sampleRate, defaultPluckParams(), () => new PluckVoice(sampleRate))));
registerProcessor('mb-drum', voiceProcessor<DrumParams>(() => new PolySynth(sampleRate, defaultDrumParams(), () => new DrumVoice(), 4)));
registerProcessor('mb-pad', voiceProcessor<PadParams>(() => new PolySynth(sampleRate, defaultPadParams(), () => new PadVoice(), 6)));
registerProcessor('mb-texture', voiceProcessor<TextureParams>(() => new PolySynth(sampleRate, defaultTextureParams(), () => new TextureVoice(), 4)));
