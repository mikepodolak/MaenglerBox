export type RecorderMessage = { type: 'stop' };

/** Number of frames gathered before a block is sent to the main thread. */
const BLOCK = 4096;

/** Passes stereo audio to the main thread in blocks, for the WAV recorder. */
class RecorderProcessor extends AudioWorkletProcessor {
  private left = new Float32Array(BLOCK);
  private right = new Float32Array(BLOCK);
  private fill = 0;
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<RecorderMessage>) => {
      if (e.data.type !== 'stop') return;
      this.flush();
      this.port.postMessage({ type: 'done' });
      this.alive = false;
    };
  }

  private flush(): void {
    if (!this.fill) return;
    this.port.postMessage({ type: 'audio', left: this.left.slice(0, this.fill), right: this.right.slice(0, this.fill) });
    this.fill = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    const l = inputs[0]?.[0];
    if (l) {
      const r = inputs[0][1] ?? l;
      for (let i = 0; i < l.length; i++) {
        this.left[this.fill] = l[i];
        this.right[this.fill] = r[i];
        if (++this.fill === BLOCK) this.flush();
      }
    }
    return this.alive;
  }
}

registerProcessor('mb-recorder', RecorderProcessor);
