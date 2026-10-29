import { LFO_SHAPES, type LfoSettings } from '../dsp/lfo';
import type { LfoMessage, LfoReport } from '../dsp/lfo.worklet';
import lfoWorkletUrl from '../dsp/lfo.worklet.ts?worker&url';
import type { ModuleType } from './types';

/** Clocks per cycle in Sync mode. */
export const LFO_SYNC = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 32, 64];
export const LFO_SYNC_LABELS = LFO_SYNC.map((n) => (n === 0.25 ? '¼ clock' : n === 0.5 ? '½ clock' : n === 1 ? '1 clock' : `${n} clocks`));

/**
 * Follows a clock: measures the time between ticks and works out how fast a
 * cycle of `clocks` ticks runs, and which ticks start a new cycle.
 */
export class ClockFollower {
  private last = -1;
  private count = 0;

  /** Returns the rate (cycles/s) once two ticks have arrived, and whether this tick starts a cycle. */
  tick(time: number, clocks: number): { rate: number | null; reset: boolean } {
    const period = this.last >= 0 ? time - this.last : 0;
    this.last = time;
    const reset = clocks <= 1 || this.count % Math.round(clocks) === 0;
    this.count++;
    return { rate: period > 0 ? 1 / (period * clocks) : null, reset };
  }

  restart(): void {
    this.count = 0;
  }
}

/**
 * Low-frequency oscillator: a slow wave to patch into any setting. Free mode
 * runs at its Rate; Sync mode follows a clock, one cycle every so many ticks.
 */
export const lfo: ModuleType = {
  worklets: [lfoWorkletUrl],
  def: {
    type: 'lfo',
    label: 'LFO',
    category: 'Modulation',
    visual: true,
    presets: true,
    description: 'A slow wave to move any setting. Drag its Out onto a slider to modulate it. Free running or synced to a clock.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'cv' }],
    params: [
      { id: 'shape', label: 'Shape', min: 0, max: LFO_SHAPES.length - 1, default: 0, step: 1, options: LFO_SHAPES },
      { id: 'mode', label: 'Timing', min: 0, max: 1, default: 0, step: 1, options: ['Free', 'Sync to clock'] },
      { id: 'rate', label: 'Rate', min: 0.02, max: 20, default: 0.5, step: 0.001, unit: 'Hz', curve: 'exp' },
      { id: 'sync', label: 'Cycle', min: 0, max: LFO_SYNC.length - 1, default: 9, step: 1, options: LFO_SYNC_LABELS },
      { id: 'polarity', label: 'Range', min: 0, max: 1, default: 0, step: 1, options: ['−1 to 1', '0 to 1'] },
      { id: 'level', label: 'Level', min: 0, max: 1, default: 1, step: 0.01 },
    ],
    face: ['shape', 'rate'],
  },
  create({ ctx }, params) {
    const p = { ...params };
    const node = new AudioWorkletNode(ctx, 'mb-lfo', { numberOfInputs: 0, outputChannelCount: [1] });
    const send = (msg: LfoMessage) => node.port.postMessage(msg);
    const follower = new ClockFollower();
    let synced: number | null = null;
    const clocks = () => LFO_SYNC[Math.round(p.sync)] ?? 16;
    const settings = (): LfoSettings => ({
      rate: p.mode && synced !== null ? synced : p.rate,
      shape: Math.round(p.shape),
      unipolar: p.polarity >= 0.5,
      level: p.level,
    });
    send({ type: 'settings', settings: settings() });
    const reports: LfoReport[] = [];
    node.port.onmessage = (e: MessageEvent<LfoReport>) => {
      reports.push(e.data);
      if (reports.length > 16) reports.shift();
    };
    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) => {
            if (!p.mode) return;
            const t = follower.tick(e.time, clocks());
            if (t.rate !== null) synced = t.rate;
            send({ type: 'event', event: { time: e.time, reset: t.reset, rate: synced ?? undefined } });
          },
        },
        reset: {
          kind: 'gate',
          handler: (e) => {
            follower.restart();
            send({ type: 'event', event: { time: e.time, reset: true } });
          },
        },
      },
      outputs: { out: { kind: 'node', node } },
      setParam(id, v) {
        p[id] = v;
        if (id === 'sync') follower.restart();
        send({ type: 'settings', settings: settings() });
      },
      getState(now) {
        let r: LfoReport | undefined;
        for (const x of reports) if (x.time <= now) r = x;
        if (!r) return { phase: 0, shape: Math.round(p.shape) };
        // Reports come every ~20 ms; carry the phase forward to now so the dot moves smoothly.
        const rate = p.mode && synced !== null ? synced : p.rate;
        return { phase: (r.phase + (now - r.time) * rate) % 1, shape: Math.round(p.shape) };
      },
      dispose() {
        send({ type: 'dispose' });
        node.disconnect();
      },
    };
  },
};
