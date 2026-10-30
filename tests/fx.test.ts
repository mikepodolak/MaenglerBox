import { describe, expect, it } from 'vitest';
import { GlitchCore } from '../src/dsp/glitch';
import { ModDelayCore } from '../src/dsp/moddelay';
import { HELP } from '../src/modules/help';
import { getDef } from '../src/modules/registry';

const ramp = (n: number, from = 0) => Float32Array.from({ length: n }, (_, i) => (from + i) / 1000);

describe('glitch', () => {
  it('passes audio through untouched until a stutter', () => {
    const g = new GlitchCore(1000, () => 0.99);
    const out = new Float32Array(100);
    g.process(ramp(100), out, 0);
    expect(out[50]).toBeCloseTo(0.05);
  });

  it('repeats the slice it just heard, and can play it backwards', () => {
    const fwd = new GlitchCore(1000, () => 0);
    fwd.settings = { chance: 1, repeats: 2, reverse: 0, bits: 16, downsample: 1, mix: 1 };
    const out = new Float32Array(200);
    fwd.process(ramp(100), new Float32Array(100), 0);
    fwd.trigger({ time: 0.1, slice: 0.05 });
    fwd.process(ramp(200, 100), out, 100);
    // The last 50 samples before the trigger (50..99), twice, then live audio again.
    expect(out[0]).toBeCloseTo(0.05);
    expect(out[49]).toBeCloseTo(0.099);
    expect(out[50]).toBeCloseTo(0.05);
    expect(out[100]).toBeCloseTo(0.2);

    const rev = new GlitchCore(1000, () => 0);
    rev.settings = { ...fwd.settings, reverse: 1 };
    rev.process(ramp(100), new Float32Array(100), 0);
    rev.trigger({ time: 0.1, slice: 0.05 });
    rev.process(ramp(200, 100), out, 100);
    expect(out[0]).toBeCloseTo(0.099);
  });

  it('crushes bits', () => {
    const g = new GlitchCore(1000, () => 0.99);
    g.settings = { chance: 0, repeats: 1, reverse: 0, bits: 2, downsample: 1, mix: 1 };
    const out = new Float32Array(1);
    g.process(Float32Array.of(0.3), out, 0);
    expect(out[0]).toBeCloseTo(0.5);
  });
});

describe('short delay line', () => {
  it('delays by the set time, and feedback makes it ring', () => {
    const d = new ModDelayCore(1000);
    d.settings = { delay: 0.01, rate: 0, depth: 0, feedback: 0.5, damp: 0, mix: 1 };
    const input = new Float32Array(40);
    input[0] = 1;
    const out = new Float32Array(40);
    d.process(input, out, 0);
    expect(out[10]).toBeCloseTo(1);
    expect(out[20]).toBeCloseTo(0.5);
    expect(out[30]).toBeCloseTo(0.25);
  });

  it('retunes on time, for notes', () => {
    const d = new ModDelayCore(1000);
    d.settings = { delay: 0.01, rate: 0, depth: 0, feedback: 0, damp: 0, mix: 1 };
    d.schedule({ time: 0, delay: 0.005 });
    const input = new Float32Array(20);
    input[0] = 1;
    const out = new Float32Array(20);
    d.process(input, out, 0);
    expect(out[5]).toBeCloseTo(1);
  });
});

describe('effects modules', () => {
  it('are registered under Effects, with help', () => {
    for (const type of ['delay', 'reverb', 'phaser', 'flanger', 'comb', 'ringmod', 'glitch']) {
      expect(getDef(type)?.category, type).toBe('Effects');
      expect(HELP[type], type).toBeDefined();
    }
  });
});
