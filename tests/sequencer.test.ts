import { describe, expect, it } from 'vitest';
import { quantize, SCALES, SequencerCore, sequencerData, type SequencerSettings } from '../src/modules/sequencer';

const settings = (s: Partial<SequencerSettings> = {}): SequencerSettings => ({
  length: 4,
  density: 1,
  pitchRandom: 0,
  octaveRandom: 0,
  scale: 0,
  root: 0,
  transpose: 0,
  ...s,
});

function data(overrides: Partial<{ on: boolean; chance: number; ratchet: number; note: number }>[] = []) {
  const d = sequencerData.create();
  d.steps = d.steps.map((s, i) => ({ ...s, on: true, chance: 1, ratchet: 1, note: 60, ...overrides[i] }));
  return d;
}

/** Deterministic random source for repeatable tests. */
function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe('SequencerCore', () => {
  it('loops over the set length', () => {
    const core = new SequencerCore(data(), settings({ length: 3 }));
    const positions = [0, 1, 2, 3, 4].map((t) => (core.clock(t), core.position));
    expect(positions).toEqual([0, 1, 2, 0, 1]);
  });

  it('skips steps that are off or have zero chance', () => {
    const core = new SequencerCore(data([{ on: false }, { chance: 0 }]), settings());
    expect(core.clock(0)).toEqual([]);
    expect(core.clock(0.25)).toEqual([]);
    expect(core.clock(0.5)).toHaveLength(1);
  });

  it('fires about as often as the chance says', () => {
    const core = new SequencerCore(data([{ chance: 0.3 }]), settings({ length: 1 }), seeded(7));
    let hits = 0;
    for (let i = 0; i < 2000; i++) hits += core.clock(i * 0.1).length;
    expect(hits / 2000).toBeGreaterThan(0.25);
    expect(hits / 2000).toBeLessThan(0.35);
  });

  it('density scales every step', () => {
    const core = new SequencerCore(data(), settings({ length: 1, density: 0 }));
    for (let i = 0; i < 20; i++) expect(core.clock(i)).toEqual([]);
  });

  it('ratchets split the step evenly using the measured clock interval', () => {
    const core = new SequencerCore(data([{}, { ratchet: 4 }]), settings());
    core.clock(0);
    const events = core.clock(0.2);
    expect(events.map((e) => +e.time.toFixed(6))).toEqual([0.2, 0.25, 0.3, 0.35]);
  });

  it('keeps random pitches inside the scale', () => {
    const minor = 1;
    const core = new SequencerCore(data(), settings({ length: 1, pitchRandom: 12, scale: minor, root: 2 }), seeded(3));
    for (let i = 0; i < 200; i++) {
      for (const e of core.clock(i)) {
        expect(SCALES[minor].intervals).toContain((((e.note! - 2) % 12) + 12) % 12);
      }
    }
  });

  it('reports the step sounding now, not the one scheduled ahead', () => {
    const core = new SequencerCore(data(), settings());
    core.clock(1);
    core.clock(1.25);
    expect(core.stepAt(0.5)).toBe(-1);
    expect(core.stepAt(1.1)).toBe(0);
    expect(core.stepAt(1.3)).toBe(1);
  });
});

describe('quantize', () => {
  it('snaps to the nearest scale degree, across octaves', () => {
    const major = SCALES[2].intervals;
    expect(quantize(61, major)).toBe(60);
    expect(quantize(66, major, 0)).toBe(65);
    expect(quantize(71, major)).toBe(71);
    expect(quantize(-1, major)).toBe(-1);
  });
});
