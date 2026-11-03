import { describe, expect, it } from 'vitest';
import { DrumVoice } from '../src/dsp/drum';
import { PolySynth } from '../src/dsp/poly';
import { defaultDrumParams } from '../src/dsp/drum';
import { getDef } from '../src/modules/registry';
import { factoryPresets } from '../src/modules/factory';
import { starterPatterns } from '../src/modules/patterns';
import type { SequencerData } from '../src/modules/sequencer';
import type { MultiTrackerData } from '../src/modules/multiTracker';
import { addModule, createPatch } from '../src/patch/model';

const getDefOrThrow = (t: string) => getDef(t)!;
import { applyPreset } from '../src/patch/presets';

describe('starter patterns', () => {
  it('a new Chance Sequencer and Tracker come with a pattern bank', () => {
    for (const type of ['sequencer', 'tracker']) {
      const [, m] = addModule(createPatch(), getDefOrThrow(type));
      expect(m.presets?.filter(Boolean).length, type).toBeGreaterThanOrEqual(2);
    }
    const [, fm] = addModule(createPatch(), getDefOrThrow('fm'));
    expect(fm.presets).toBeUndefined();
  });

  it('every pattern plays something and stays in range', () => {
    for (const p of starterPatterns(getDefOrThrow('sequencer'))) {
      const d = p!.data as SequencerData;
      const on = d.steps.slice(0, p!.params.length).filter((s) => s.on);
      expect(on.length, p!.name).toBeGreaterThan(2);
      for (const s of on) expect(s.chance, p!.name).toBeGreaterThan(0);
    }
    for (const p of starterPatterns(getDefOrThrow('tracker'))) {
      const d = p!.data as MultiTrackerData;
      expect(d.tracks.filter((t) => t.steps.some((s) => s.on)).length, p!.name).toBeGreaterThanOrEqual(4);
    }
  });

  it('kit patterns call up FM Drum presets that exist', () => {
    const drums = factoryPresets(getDefOrThrow('drum'));
    const kits = starterPatterns(getDefOrThrow('sequencer')).filter((p) => p!.name.startsWith('Kit'));
    expect(kits.length).toBeGreaterThan(2);
    for (const k of kits) for (const s of (k!.data as SequencerData).steps) if (s.on) expect(drums[s.send - 1], `${k!.name} send ${s.send}`).toBeDefined();
  });

  it('loading a pattern replaces the steps and settings', () => {
    const def = getDefOrThrow('sequencer');
    const [p0, m] = addModule(createPatch(), def);
    const poly = m.presets!.find((p) => p?.name === 'Polymeter 7')!;
    const loaded = applyPreset(p0, getDef, m.id, poly).modules[0];
    expect(loaded.params.length).toBe(7);
    expect((loaded.data as SequencerData).steps[0].velocity).toBe(1);
  });

  it('drum hits on the same note don’t cut each other off', () => {
    const synth = new PolySynth(48000, defaultDrumParams(), () => new DrumVoice(), 6, false);
    synth.schedule({ time: 0, note: 48, velocity: 1, length: 0.1 });
    synth.schedule({ time: 0.01, note: 48, velocity: 1, length: 0.1 });
    synth.process(new Float32Array(1000), 0, 1);
    expect(synth.activeVoices).toBe(2);
  });
});

describe('Chassis-inspired presets', () => {
  it('Drum Map and Lanes start with banks whose settings are in range', () => {
    for (const type of ['drummap', 'lanes']) {
      const def = getDefOrThrow(type);
      const [, m] = addModule(createPatch(), def);
      expect(m.presets?.filter(Boolean).length, type).toBeGreaterThanOrEqual(5);
      for (const p of m.presets!) {
        for (const [k, v] of Object.entries(p!.params)) {
          const d = def.params.find((x) => x.id === k);
          expect(d, `${type} ${p!.name} ${k}`).toBeDefined();
          expect(v).toBeGreaterThanOrEqual(d!.min);
          expect(v).toBeLessThanOrEqual(d!.max);
        }
      }
    }
  });

  it('Freq Shifter has factory presets in range', () => {
    const def = getDefOrThrow('shifter');
    const presets = factoryPresets(def);
    expect(presets.length).toBeGreaterThanOrEqual(4);
    for (const p of presets) for (const d of def.params) if (d.id !== 'morph') expect(p.params[d.id]).toBeGreaterThanOrEqual(d.min);
  });
});
