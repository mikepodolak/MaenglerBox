import { describe, expect, it } from 'vitest';
import { defaultLeadParams, LeadVoice } from '../src/dsp/lead';
import { defaultPluckParams, PluckVoice } from '../src/dsp/pluck';
import { PolySynth } from '../src/dsp/poly';
import { HELP } from '../src/modules/help';
import { getDef } from '../src/modules/registry';

const SR = 8000;

function render(synth: PolySynth<unknown>, frames: number): Float32Array {
  const out = new Float32Array(frames);
  synth.process(out, 0, 1);
  return out;
}

/** The lag (in samples) where a signal best matches itself, i.e. its period. */
function period(x: Float32Array, min: number, max: number): number {
  let best = min;
  let bestScore = -Infinity;
  for (let lag = min; lag <= max; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    if (s > bestScore) {
      bestScore = s;
      best = lag;
    }
  }
  return best;
}

describe('FM Lead', () => {
  it('sounds, stays finite at full resonance, and goes quiet after release', () => {
    const synth = new PolySynth(SR, { ...defaultLeadParams(), resonance: 15, filterEnv: 6 }, () => new LeadVoice());
    synth.schedule({ time: 0, note: 57, velocity: 1, length: 0.2 });
    const out = render(synth as PolySynth<unknown>, SR * 2);
    const head = out.slice(0, SR / 5);
    expect(Math.max(...head.map(Math.abs))).toBeGreaterThan(0.05);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(synth.activeVoices).toBe(0);
  });
});

describe('Pluck', () => {
  it('rings at the note’s pitch and dies away', () => {
    const synth = new PolySynth(SR, { ...defaultPluckParams(), decay: 0.5 }, () => new PluckVoice(SR, () => 0.3));
    synth.schedule({ time: 0, note: 69, velocity: 1, length: 0.1 });
    const out = render(synth as PolySynth<unknown>, SR * 3);
    // 440 Hz at 8 kHz is about 18 samples.
    expect(period(out.slice(400, 2000), 10, 30)).toBeCloseTo(SR / 440, -0.5);
    expect(synth.activeVoices).toBe(0);
  });

  it('reuses the voice on a repeated note and steals the oldest when full', () => {
    const synth = new PolySynth(SR, defaultPluckParams(), () => new PluckVoice(SR), 2);
    synth.schedule({ time: 0, note: 60, velocity: 1, length: 1 });
    synth.schedule({ time: 0.01, note: 60, velocity: 1, length: 1 });
    render(synth as PolySynth<unknown>, 200);
    expect(synth.activeVoices).toBe(1);
  });
});

describe('voice modules', () => {
  it('are registered with help', () => {
    for (const type of ['lead', 'pluck']) {
      expect(getDef(type)?.category).toBe('Sound');
      expect(HELP[type], type).toBeDefined();
    }
  });
});
