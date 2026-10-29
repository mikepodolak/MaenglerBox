import { describe, expect, it } from 'vitest';
import type { GateEvent } from '../src/engine/gate';
import { multiTracker, multiTrackerData, TRACKS, trackPort } from '../src/modules/multiTracker';
import type { EngineEnv } from '../src/modules/types';

function params() {
  return Object.fromEntries(multiTracker.def.params.map((p) => [p.id, p.default]));
}

/** Build a Tracker and collect what each track's output sends. */
function setup(data = multiTrackerData.create()) {
  const rt = multiTracker.create({} as EngineEnv, params(), data);
  const got: GateEvent[][] = Array.from({ length: TRACKS }, () => []);
  for (let t = 0; t < TRACKS; t++) {
    const out = rt.outputs[trackPort(t)];
    if (out.kind === 'gate') out.out.connect((e) => got[t].push(e));
  }
  const clock = (time: number) => {
    const input = rt.inputs.clock;
    if (input.kind === 'gate') input.handler({ time, value: 1, length: 0.05 });
  };
  return { rt, got, clock };
}

describe('multi-track Tracker', () => {
  it('has one Notes output per track', () => {
    expect(multiTracker.def.outputs.map((o) => o.id)).toEqual(Array.from({ length: TRACKS }, (_, t) => `out${t + 1}`));
  });

  it('each track plays its own steps to its own output', () => {
    const data = multiTrackerData.create();
    data.tracks[2].steps[1] = { ...data.tracks[2].steps[1], on: true, chance: 1, note: 62 };
    const { got, clock } = setup(data);
    for (let i = 0; i < 4; i++) clock(i * 0.125);
    expect(got[0]).toHaveLength(1); // the default kick on step 1
    expect(got[2].map((e) => e.note)).toEqual([62]);
    expect(got[1]).toHaveLength(0);
  });

  it('muted tracks stay silent but keep time', () => {
    const data = multiTrackerData.create();
    data.mutes[0] = true;
    const { rt, got, clock } = setup(data);
    clock(0);
    expect(got[0]).toHaveLength(0);
    rt.setData!({ ...data, mutes: data.mutes.map(() => false) });
    for (let i = 1; i <= 4; i++) clock(i * 0.125);
    // Step 5 (index 4) is the next kick, so unmuting picks up in time.
    expect(got[0]).toHaveLength(1);
    expect(got[0][0].time).toBe(0.5);
  });

  it('settings reach every track', () => {
    const data = multiTrackerData.create();
    data.tracks[5].steps[0] = { ...data.tracks[5].steps[0], on: true, chance: 1, note: 48 };
    const { rt, got, clock } = setup(data);
    rt.setParam('transpose', 12);
    clock(0);
    expect(got[0][0].note).toBe(60);
    expect(got[5][0].note).toBe(60);
  });

  it('cleans up saved data', () => {
    const n = multiTrackerData.normalize({ tracks: [{ steps: [{ on: true, note: 999 }] }, 'junk'], mutes: [true, 'yes'] });
    expect(n.tracks).toHaveLength(TRACKS);
    expect(n.tracks[0].steps[0].note).toBe(127);
    expect(n.mutes.slice(0, 3)).toEqual([true, false, false]);
  });
});
