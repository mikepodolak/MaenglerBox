import { describe, expect, it } from 'vitest';
import { DrumVoice, type DrumParams } from '../src/dsp/drum';
import { LeadVoice, type LeadParams } from '../src/dsp/lead';
import { PadVoice, type PadParams } from '../src/dsp/pad';
import { PluckVoice, type PluckParams } from '../src/dsp/pluck';
import { PolySynth, type PolyVoice } from '../src/dsp/poly';
import { TextureVoice, type TextureParams } from '../src/dsp/texture';
import { factoryPresets, seedBank, seedLibrary } from '../src/modules/factory';
import { getDef } from '../src/modules/registry';

const SR = 48000;

/** A seeded random, so renders are the same every run. */
function rng(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

/** Render one note (and its tail) and report peak and RMS. */
function render<P>(voice: () => PolyVoice<P>, params: P, seconds: number, length = 0.5, note = 60) {
  const synth = new PolySynth(SR, params, voice, 2);
  synth.schedule({ time: 0, note, velocity: 1, length });
  const out = new Float32Array(Math.round(seconds * SR));
  synth.process(out, 0, 1);
  let peak = 0;
  let sum = 0;
  for (const x of out) {
    if (!Number.isFinite(x)) return { peak: NaN, rms: NaN, active: synth.activeVoices };
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  return { peak, rms: Math.sqrt(sum / out.length), active: synth.activeVoices };
}

const cases: [string, () => PolyVoice<never>, number][] = [
  ['drum', () => new DrumVoice(rng()) as PolyVoice<never>, 3],
  ['pad', () => new PadVoice(rng()) as PolyVoice<never>, 4],
  ['texture', () => new TextureVoice(rng()) as PolyVoice<never>, 4],
  ['lead', () => new LeadVoice() as PolyVoice<never>, 3],
  ['pluck', () => new PluckVoice(SR, rng()) as PolyVoice<never>, 3],
];

describe('factory presets', () => {
  for (const [type, voice, seconds] of cases) {
    it(`every ${type} preset makes a usable, finite sound`, () => {
      for (const preset of factoryPresets(getDef(type)!)) {
        const r = render(voice, preset.params as never, seconds, type === 'pad' || type === 'texture' ? 2 : 0.3);
        // What leaves the module: the worklet scales by Level × 0.5.
        const peak = r.peak * preset.params.level * 0.5;
        if (process.env.LEVELS) console.log(type, preset.name, peak.toFixed(2), (r.rms * preset.params.level * 0.5).toFixed(3));
        expect(peak, `${type} ${preset.name}`).toBeGreaterThan(0.02);
        expect(peak, `${type} ${preset.name}`).toBeLessThan(1);
      }
    });
  }

  it('cover every setting, so loading one replaces the whole sound', () => {
    for (const type of ['fm', 'drum', 'pad', 'texture', 'lead', 'pluck']) {
      const def = getDef(type)!;
      for (const p of factoryPresets(def)) {
        for (const param of def.params) if (param.id !== 'morph') expect(p.params[param.id], `${type} ${p.name} ${param.id}`).toBeTypeOf('number');
        for (const [k, v] of Object.entries(p.params)) {
          const d = def.params.find((x) => x.id === k)!;
          expect(d, `${type} ${p.name} ${k}`).toBeDefined();
          expect(v).toBeGreaterThanOrEqual(d.min);
          expect(v).toBeLessThanOrEqual(d.max);
        }
      }
    }
  });

  it('fill empty slots only, once per type', () => {
    const mine = { name: 'mine', params: {} };
    const fresh = factoryPresets(getDef('drum')!);
    const bank = seedBank([null, mine], fresh);
    expect(bank[0]?.name).toBe('Sub kick');
    expect(bank[1]).toBe(mine);
    expect(bank.filter(Boolean)).toHaveLength(fresh.length + 1);
    expect(seedBank(bank, fresh)).toEqual(bank);
    const r = seedLibrary({}, new Set(['drum']), getDef);
    expect(r.changed).not.toContain('drum');
    expect(r.changed).toContain('pad');
  });
});

describe('new voices', () => {
  it('a drum rings out whatever the note length, then stops', () => {
    const p = factoryPresets(getDef('drum')!)[0].params as unknown as DrumParams;
    expect(render(() => new DrumVoice(rng()), p, 0.1, 0.001).active).toBe(1);
    expect(render(() => new DrumVoice(rng()), p, 3, 0.001).active).toBe(0);
  });

  it('a pad holds while the note does and fades after', () => {
    const p = factoryPresets(getDef('pad')!)[0].params as unknown as PadParams;
    expect(render(() => new PadVoice(rng()), p, 1, 2).active).toBe(1);
    expect(render(() => new PadVoice(rng()), p, 8, 0.5).active).toBe(0);
  });

  it('a texture keeps raining grains while held', () => {
    const p = factoryPresets(getDef('texture')!)[0].params as unknown as TextureParams;
    const held = render(() => new TextureVoice(rng()), p, 2, 3);
    expect(held.rms).toBeGreaterThan(0.005);
    expect(render(() => new TextureVoice(rng()), p, 6, 0.5).active).toBe(0);
  });

  it('types line up with the DSP settings', () => {
    const lead: Partial<LeadParams> = factoryPresets(getDef('lead')!)[0].params;
    const pluck: Partial<PluckParams> = factoryPresets(getDef('pluck')!)[0].params;
    expect(lead.cutoff).toBeTypeOf('number');
    expect(pluck.decay).toBeTypeOf('number');
  });
});
