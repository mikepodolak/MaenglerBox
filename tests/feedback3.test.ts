import { describe, expect, it } from 'vitest';
import { envelopeStages } from '../src/modules/core';
import { getDef } from '../src/modules/registry';
import { sequencerData, SequencerCore, type SequencerSettings } from '../src/modules/sequencer';

const base: SequencerSettings = { length: 4, density: 1, pitchRandom: 0, octaveRandom: 0, scale: 0, root: 0, transpose: 0 };

function positions(direction: number, n: number, random = () => 0.9): number[] {
  const core = new SequencerCore(sequencerData.create(), { ...base, direction }, random);
  return Array.from({ length: n }, (_, i) => {
    core.clock(i);
    return core.position;
  });
}

describe('playback directions', () => {
  it('forward and backward', () => {
    expect(positions(0, 6)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(positions(1, 6)).toEqual([3, 2, 1, 0, 3, 2]);
  });

  it('ping-pong plays each end once per turn', () => {
    expect(positions(2, 9)).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2]);
  });

  it('random and drunk stay inside the pattern', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const r = positions(3, 200, rnd);
    expect(r.every((p) => p >= 0 && p < 4)).toBe(true);
    expect(new Set(r).size).toBe(4);
    const d = positions(4, 200, rnd);
    for (let i = 1; i < d.length; i++) expect([1, 3]).toContain((d[i] - d[i - 1] + 4) % 4);
  });

  it('conditions count a loop every length steps, whatever the direction', () => {
    const core = new SequencerCore(sequencerData.create(), { ...base, direction: 2 }, () => 0.9);
    for (let i = 0; i < 4; i++) core.clock(i);
    expect(core.loop).toBe(0);
    core.clock(4);
    expect(core.loop).toBe(1);
  });
});

describe('envelope modes', () => {
  const p = { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 };

  it('ADSR holds at sustain until the gate ends, then releases', () => {
    expect(envelopeStages({ ...p, mode: 0 }, 1)).toEqual([
      { target: 1, at: 0, time: 0.01 },
      { target: 0.5, at: 0.01, time: 0.2 },
      { target: 0, at: 1, time: 0.3 },
    ]);
  });

  it('ADR decays to zero while the gate is held', () => {
    expect(envelopeStages({ ...p, mode: 1 }, 1)[1].target).toBe(0);
  });

  it('a gate shorter than the attack goes straight to release', () => {
    expect(envelopeStages({ ...p, mode: 0 }, 0.005).map((s) => s.target)).toEqual([1, 0]);
  });
});

describe('which modules get presets', () => {
  it('instruments and sequencers do, utilities do not', () => {
    for (const t of ['fm', 'sequencer', 'tracker', 'envelope', 'oscillator']) expect(getDef(t)?.presets, t).toBe(true);
    for (const t of ['output', 'vca', 'clock']) expect(getDef(t)?.presets, t).toBeFalsy();
  });
});
