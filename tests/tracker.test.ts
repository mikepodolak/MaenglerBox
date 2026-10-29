import { describe, expect, it } from 'vitest';
import { FMSynth, defaultFMParams } from '../src/dsp/fm';
import { conditionPasses, sequencerData, SequencerCore, type SequencerSettings } from '../src/modules/sequencer';

const settings: SequencerSettings = { length: 2, density: 1, pitchRandom: 0, octaveRandom: 0, scale: 0, root: 0, transpose: 0 };

/** A 2-step pattern: step 0 always plays, step 1 has `cond`. Returns which loops step 1 played on. */
function loopsPlayed(cond: string, loops = 8, fill = 0, firstChance = 1): number[] {
  const data = sequencerData.create();
  data.steps = data.steps.map((s, i) => ({ ...s, on: i < 2, chance: i === 0 ? firstChance : 1, cond: i === 1 ? cond : '' }));
  const core = new SequencerCore(data, { ...settings, fill }, () => 0.6);
  const out: number[] = [];
  for (let loop = 0; loop < loops; loop++) {
    core.clock(loop * 2);
    if (core.clock(loop * 2 + 1).length) out.push(loop);
  }
  return out;
}

describe('trig conditions', () => {
  it('A:B plays on the A-th of every B loops', () => {
    expect(loopsPlayed('1:2')).toEqual([0, 2, 4, 6]);
    expect(loopsPlayed('2:4')).toEqual([1, 5]);
    expect(loopsPlayed('3:3', 9)).toEqual([2, 5, 8]);
  });

  it('first and not first', () => {
    expect(loopsPlayed('first')).toEqual([0]);
    expect(loopsPlayed('!first', 4)).toEqual([1, 2, 3]);
  });

  it('fill follows the fill switch', () => {
    expect(loopsPlayed('fill', 2, 0)).toEqual([]);
    expect(loopsPlayed('fill', 2, 1)).toEqual([0, 1]);
    expect(loopsPlayed('!fill', 2, 1)).toEqual([]);
  });

  it('pre follows whether the previous on-step played', () => {
    // Step 0 has chance 0.5 and the random source always says 0.6, so step 0 never plays.
    expect(loopsPlayed('pre', 4, 0, 0.5)).toEqual([]);
    expect(loopsPlayed('!pre', 4, 0, 0.5)).toEqual([0, 1, 2, 3]);
    expect(loopsPlayed('pre', 4)).toEqual([0, 1, 2, 3]);
  });

  it('reset starts counting loops again', () => {
    const data = sequencerData.create();
    data.steps = data.steps.map((s, i) => ({ ...s, on: true, chance: 1, cond: i === 0 ? 'first' : '' }));
    const core = new SequencerCore(data, settings, () => 0);
    expect(core.clock(0)).toHaveLength(1);
    core.clock(1);
    expect(core.clock(2)).toHaveLength(0);
    core.reset();
    expect(core.clock(3)).toHaveLength(1);
  });

  it('unknown conditions are dropped on load', () => {
    const raw = sequencerData.create();
    (raw.steps[0] as { cond: string }).cond = 'sometimes';
    raw.steps[1].cond = '3:4';
    const n = sequencerData.normalize(raw);
    expect(n.steps[0].cond).toBe('');
    expect(n.steps[1].cond).toBe('3:4');
    expect(conditionPasses('3:4', 2, false)).toBe(true);
  });
});

describe('parameter locks', () => {
  it("ride on the step's notes", () => {
    const data = sequencerData.create();
    data.steps = data.steps.map((s, i) => ({ ...s, on: true, chance: 1, ratchet: 2, plocks: i === 0 ? { feedback: 0.9 } : {} }));
    const core = new SequencerCore(data, settings, () => 0);
    const first = core.clock(0, 0.25);
    expect(first.every((e) => e.params?.feedback === 0.9)).toBe(true);
    expect(core.clock(0.5)[0].params).toBeUndefined();
  });

  it('are cleaned up on load', () => {
    const raw = sequencerData.create() as unknown as { steps: { plocks: unknown }[] };
    raw.steps[0].plocks = { feedback: 0.3, junk: 'x', nan: NaN };
    raw.steps[1].plocks = 'nope';
    const n = sequencerData.normalize(raw);
    expect(n.steps[0].plocks).toEqual({ feedback: 0.3 });
    expect(n.steps[1].plocks).toEqual({});
  });

  it('a locked note sounds different from the live settings', () => {
    const render = (params?: ReturnType<typeof defaultFMParams>) => {
      const synth = new FMSynth(48000);
      synth.schedule({ time: 0, note: 60, velocity: 1, length: 0.1, params });
      const out = new Float32Array(4800);
      for (let i = 0; i < out.length; i += 128) synth.process(out.subarray(i, i + 128), i);
      return out;
    };
    const base = defaultFMParams();
    const locked = { ...base, ops: base.ops.map((o, i) => (i === 1 ? { ...o, ratio: o.ratio * 3 } : o)) };
    const a = render();
    const b = render(locked);
    expect(b.some((x, i) => Math.abs(x - a[i]) > 1e-3)).toBe(true);
  });
});
