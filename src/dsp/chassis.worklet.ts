import { FollowerCore, MathCore, ShifterCore, type FollowerEdge, type FollowerSettings, type MathSettings, type ShifterSettings } from './chassis';

export type FollowerMessage = { type: 'settings'; settings: FollowerSettings } | { type: 'dispose' };
export type MathMessage = { type: 'settings'; settings: MathSettings } | { type: 'dispose' };
export type ShifterMessage = { type: 'settings'; settings: ShifterSettings } | { type: 'dispose' };

/** Threshold crossings and the level, posted back for the gate out and the card. */
export interface FollowerReport {
  time: number;
  level: number;
  edges: { time: number; rising: boolean }[];
}

const REPORT_FRAMES = 512;

class FollowerProcessor extends AudioWorkletProcessor {
  private core = new FollowerCore();
  private alive = true;
  private since = 0;
  private edges: FollowerEdge[] = [];

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<FollowerMessage>) => {
      if (e.data.type === 'settings') this.core.settings = { ...e.data.settings };
      else this.alive = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (!out) return this.alive;
    this.core.process(inputs[0]?.[0], out, currentFrame, sampleRate, this.edges);
    this.since += out.length;
    // Edges go straight away so gates stay tight; the level goes a few dozen times a second.
    if (this.edges.length || this.since >= REPORT_FRAMES) {
      this.since = 0;
      const report: FollowerReport = {
        time: currentTime,
        level: out[out.length - 1],
        edges: this.edges.map((x) => ({ time: x.frame / sampleRate, rising: x.rising })),
      };
      this.edges = [];
      this.port.postMessage(report);
    }
    return this.alive;
  }
}

class MathProcessor extends AudioWorkletProcessor {
  private core = new MathCore();
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MathMessage>) => {
      if (e.data.type === 'settings') this.core.settings = { ...e.data.settings };
      else this.alive = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (out) this.core.process(inputs[0]?.[0], inputs[1]?.[0], out, sampleRate);
    return this.alive;
  }
}

class ShifterProcessor extends AudioWorkletProcessor {
  private core = new ShifterCore();
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ShifterMessage>) => {
      if (e.data.type === 'settings') this.core.settings = { ...e.data.settings };
      else this.alive = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (out) this.core.process(inputs[0]?.[0], out, sampleRate);
    return this.alive;
  }
}

registerProcessor('mb-follower', FollowerProcessor);
registerProcessor('mb-math', MathProcessor);
registerProcessor('mb-shifter', ShifterProcessor);
