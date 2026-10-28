import { describe, expect, it } from 'vitest';
import { ALGORITHMS, FMSynth, midiToHz } from '../src/dsp/fm';
import { toFMParams } from '../src/modules/fmVoice';
import { getDef } from '../src/modules/registry';
import { defaultParams } from '../src/patch/model';

const SR = 48000;

function render(synth: FMSynth, seconds: number, start = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i += 128) synth.process(out.subarray(i, i + 128), start + i);
  return out;
}

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

describe('FMSynth', () => {
  it('is silent until a note is scheduled', () => {
    expect(rms(render(new FMSynth(SR), 0.1))).toBe(0);
  });

  it('starts the note on the exact scheduled frame', () => {
    const synth = new FMSynth(SR);
    synth.schedule({ time: 1000 / SR, note: 60, velocity: 1, length: 0.1 });
    const out = render(synth, 0.05);
    expect(out.slice(0, 1001).every((x) => x === 0)).toBe(true);
    expect(rms(out.slice(1001, 2000))).toBeGreaterThan(0.01);
  });

  it('releases to silence after the note length and frees the voice', () => {
    const synth = new FMSynth(SR);
    synth.schedule({ time: 0, note: 60, velocity: 1, length: 0.05 });
    render(synth, 2);
    expect(synth.activeVoices).toBe(0);
  });

  it('stays within a sane range on every algorithm at full feedback', () => {
    for (let a = 0; a < ALGORITHMS.length; a++) {
      const synth = new FMSynth(SR);
      synth.params = { ...synth.params, algorithm: a, feedback: 1 };
      for (let n = 0; n < 6; n++) synth.schedule({ time: 0, note: 40 + n * 5, velocity: 1, length: 0.5 });
      const out = render(synth, 0.3);
      const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      expect(Number.isFinite(peak)).toBe(true);
      expect(peak).toBeLessThan(4);
    }
  });

  it('a pure carrier plays the right pitch', () => {
    const synth = new FMSynth(SR);
    synth.params = {
      ...synth.params,
      algorithm: 7,
      ops: synth.params.ops.map((o, i) => ({ ...o, level: i === 0 ? 1 : 0, sustain: 1, decay: 1 })),
    };
    synth.schedule({ time: 0, note: 69, velocity: 1, length: 1 });
    const out = render(synth, 0.5).slice(SR * 0.1);
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
    expect(crossings / (out.length / SR)).toBeCloseTo(midiToHz(69), -1);
  });

  it('steals the oldest voice when polyphony runs out', () => {
    const synth = new FMSynth(SR, 2);
    for (let n = 0; n < 3; n++) synth.schedule({ time: n * 0.01, note: 60 + n, velocity: 1, length: 1 });
    render(synth, 0.05);
    expect(synth.activeVoices).toBe(2);
  });
});

describe('FM module params', () => {
  it('maps the flat param map onto operators', () => {
    const p = toFMParams(defaultParams(getDef('fm')!));
    expect(p.ops).toHaveLength(4);
    expect(p.algorithm).toBe(0);
    expect(p.ops[1].ratio).toBe(2);
  });
});
