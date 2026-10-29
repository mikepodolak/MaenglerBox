import { describe, expect, it } from 'vitest';
import { FMSynth, defaultFMParams } from '../src/dsp/fm';
import { getDef } from '../src/modules/registry';
import { randomizeSteps, SCALES, sequencerData, SequencerCore } from '../src/modules/sequencer';
import { addModule, createPatch, deserializePatch, setParam } from '../src/patch/model';
import { clearPreset, randomizeParams, recallPreset, renamePreset, savePreset, setLocked } from '../src/patch/presets';

const def = (t: string) => getDef(t)!;

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe('presets', () => {
  it('saves, recalls, renames and clears', () => {
    let [p, fm] = addModule(createPatch(), def('fm'));
    p = setParam(p, getDef, fm.id, 'feedback', 0.9);
    p = savePreset(p, fm.id, 1, 'Snare');
    p = setParam(p, getDef, fm.id, 'feedback', 0.1);
    p = recallPreset(p, getDef, fm.id, 1);
    expect(p.modules[0].params.feedback).toBe(0.9);
    p = renamePreset(p, fm.id, 1, 'Rim');
    expect(p.modules[0].presets?.[1]?.name).toBe('Rim');
    p = clearPreset(p, fm.id, 1);
    expect(p.modules[0].presets?.[1]).toBeNull();
    // Recalling an empty slot changes nothing.
    expect(recallPreset(p, getDef, fm.id, 1)).toBe(p);
  });

  it('sequencer presets are pattern banks: they carry the steps', () => {
    let [p, seq] = addModule(createPatch(), def('sequencer'));
    p = savePreset(p, seq.id, 0, 'A1');
    const changed = { ...(p.modules[0].data as object), steps: sequencerData.create().steps.map((s) => ({ ...s, on: false })) };
    p = { ...p, modules: [{ ...p.modules[0], data: changed }] };
    p = recallPreset(p, getDef, seq.id, 0);
    expect((p.modules[0].data as { steps: { on: boolean }[] }).steps.some((s) => s.on)).toBe(true);
  });

  it('survives a save and load, and drops junk', () => {
    let [p, fm] = addModule(createPatch(), def('fm'));
    p = savePreset(p, fm.id, 2, 'Kick');
    p = setLocked(p, fm.id, 'algorithm', true);
    const raw = JSON.parse(JSON.stringify(p));
    raw.modules[0].presets[3] = { name: 5, params: 'nope' };
    raw.modules[0].locks.push('notAParam');
    const back = deserializePatch(raw, getDef);
    expect(back.modules[0].presets?.[2]?.name).toBe('Kick');
    expect(back.modules[0].presets?.[3]).toBeNull();
    expect(back.modules[0].locks).toEqual(['algorithm']);
  });
});

describe('randomize', () => {
  it('leaves locked params alone and keeps values in range', () => {
    let [p, fm] = addModule(createPatch(), def('fm'));
    p = setLocked(p, fm.id, 'level', true);
    const before = p.modules[0].params;
    p = randomizeParams(p, getDef, fm.id, { amount: 1, random: seeded(5) });
    const after = p.modules[0].params;
    expect(after.level).toBe(before.level);
    expect(Object.keys(after).filter((k) => after[k] !== before[k]).length).toBeGreaterThan(10);
    for (const pd of def('fm').params) {
      expect(after[pd.id]).toBeGreaterThanOrEqual(pd.min);
      expect(after[pd.id]).toBeLessThanOrEqual(pd.max);
    }
  });

  it('mutate moves values only a little', () => {
    let [p, fm] = addModule(createPatch(), def('fm'));
    const before = p.modules[0].params.feedback;
    p = randomizeParams(p, getDef, fm.id, { amount: 0.05, random: seeded(9) });
    expect(Math.abs(p.modules[0].params.feedback - before)).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('randomizes one step without touching the others, and respects field locks', () => {
    const data = { ...sequencerData.create(), locks: ['note' as const] };
    const out = randomizeSteps(data, { amount: 1, steps: [3], random: seeded(2) });
    out.steps.forEach((s, i) => {
      if (i !== 3) expect(s).toEqual(data.steps[i]);
    });
    expect(out.steps[3].note).toBe(data.steps[3].note);
  });

  it('keeps randomized notes in the scale', () => {
    const minor = 1;
    const out = randomizeSteps(sequencerData.create(), { amount: 1, scale: minor, root: 9, random: seeded(4) });
    for (const s of out.steps) expect(SCALES[minor].intervals).toContain((((s.note - 9) % 12) + 12) % 12);
  });
});

describe('step values pick presets', () => {
  it('a step with send=2 emits index 2', () => {
    const data = sequencerData.create();
    data.steps = data.steps.map((s, i) => ({ ...s, on: true, chance: 1, send: i === 1 ? 2 : 0 }));
    const core = new SequencerCore(data, { length: 4, density: 1, pitchRandom: 0, octaveRandom: 0, scale: 0, root: 0, transpose: 0 });
    expect(core.clock(0)[0].index).toBeUndefined();
    expect(core.clock(0.25)[0].index).toBe(2);
  });

  it('a note with its own params sounds different from the live settings', () => {
    const render = (params?: ReturnType<typeof defaultFMParams>) => {
      const synth = new FMSynth(48000);
      synth.schedule({ time: 0, note: 60, velocity: 1, length: 0.1, params });
      const out = new Float32Array(4800);
      for (let i = 0; i < out.length; i += 128) synth.process(out.subarray(i, i + 128), i);
      return out;
    };
    const plain = render();
    const custom = render({ ...defaultFMParams(), algorithm: 7, feedback: 1 });
    expect(custom.some((x, i) => Math.abs(x - plain[i]) > 1e-3)).toBe(true);
  });
});
