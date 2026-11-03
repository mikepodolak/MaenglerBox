import { describe, expect, it } from 'vitest';
import { FollowerCore, fold, MathCore, mathOp, ShifterCore, type FollowerEdge } from '../src/dsp/chassis';
import { BODIES, ModalVoice, modeDecay, stretchedRatios } from '../src/dsp/modal';
import { PolySynth } from '../src/dsp/poly';
import { defaultSupersawParams, sawGains, SupersawVoice } from '../src/dsp/supersaw';
import { defaultModalParams } from '../src/dsp/modal';
import { GateOutput, type GateEvent } from '../src/engine/gate';
import { DRUM_STEPS, drumHit, drumMap, lanesData, logic, logicValue, mapIntensity, paintLane, seededRandom } from '../src/modules/chassis';
import { getDef } from '../src/modules/registry';

const SR = 48000;

function rng(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

/** Collect what a module's gate output sends. */
function listen(out: { kind: string; out?: GateOutput }) {
  const got: GateEvent[] = [];
  (out as { out: GateOutput }).out.connect((e) => got.push(e));
  return got;
}

const env = {} as never;

describe('Drum Map', () => {
  it('reads every map corner as one of its patterns, and blends in between', () => {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      for (let l = 0; l < 4; l++) for (let s = 0; s < DRUM_STEPS; s++) {
        const v = mapIntensity(x, y, l, s);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // Kick on the downbeat everywhere on the map.
    expect(mapIntensity(0.2, 0.7, 0, 0)).toBe(1);
    const mid = mapIntensity(0.25, 0, 2, 1);
    expect(mid).toBeCloseTo((mapIntensity(0, 0, 2, 1) + mapIntensity(0.5, 0, 2, 1)) / 2, 6);
  });

  it('gets busier towards the top of the map', () => {
    const count = (y: number) => {
      let n = 0;
      for (let l = 0; l < 4; l++) for (let s = 0; s < DRUM_STEPS; s++) if (drumHit(mapIntensity(0.5, y, l, s), 0.5)) n++;
      return n;
    };
    expect(count(1)).toBeGreaterThan(count(0.5));
    expect(count(0.5)).toBeGreaterThan(count(0));
  });

  it('density 0 is silent and 1 plays every written step', () => {
    expect(drumHit(1, 0)).toBe(false);
    expect(drumHit(0.11, 1)).toBe(true);
    expect(drumHit(0, 1)).toBe(false);
  });

  it('repeats its wobble for the same seed', () => {
    expect(seededRandom(42, 1, 3)).toBe(seededRandom(42, 1, 3));
    expect(seededRandom(42, 1, 3)).not.toBe(seededRandom(43, 1, 3));
  });

  it('plays kick on step 1 and sends kit notes with preset numbers', () => {
    const def = getDef('drummap')!;
    const params = Object.fromEntries(def.params.map((p) => [p.id, p.default]));
    const m = drumMap.create(env, { ...params, chaos: 0 }, undefined);
    const kicks = listen(m.outputs.kick);
    const notes = listen(m.outputs.notes);
    const clock = m.inputs.clock as { handler: (e: GateEvent) => void };
    for (let i = 0; i < DRUM_STEPS; i++) clock.handler({ time: i * 0.125, value: 1, length: 0.0625 });
    expect(kicks[0].time).toBe(0);
    expect(notes.every((n) => n.index! >= 1 && n.index! <= 4)).toBe(true);
    expect(notes.length).toBeGreaterThan(kicks.length);
  });
});

describe('Logic', () => {
  const make = (op: number, divide = 3) => {
    const m = logic.create(env, { op, divide }, undefined);
    const a = (m.inputs.a as { handler: (e: GateEvent) => void }).handler;
    const b = (m.inputs.b as { handler: (e: GateEvent) => void }).handler;
    return { a, b, out: listen(m.outputs.out), other: listen(m.outputs.else) };
  };
  const g = (time: number, length = 0.05): GateEvent => ({ time, value: 1, length });
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('truth tables', () => {
    expect([logicValue(0, true, true), logicValue(0, true, false)]).toEqual([true, false]);
    expect([logicValue(1, false, true), logicValue(1, false, false)]).toEqual([true, false]);
    expect([logicValue(2, true, true), logicValue(2, true, false)]).toEqual([false, true]);
    expect([logicValue(3, true, true), logicValue(3, true, false)]).toEqual([false, true]);
  });

  it('AND fires once when both arrive together, whichever comes first', async () => {
    const l = make(0);
    l.b(g(1));
    l.a(g(1));
    l.a(g(2));
    await settle();
    expect(l.out.map((e) => e.time)).toEqual([1]);
    expect(l.other.map((e) => e.time)).toEqual([2]);
  });

  it('XOR drops moments where both play', async () => {
    const l = make(2);
    l.a(g(1));
    l.b(g(1));
    l.a(g(2));
    l.b(g(3));
    await settle();
    expect(l.out.map((e) => e.time)).toEqual([2, 3]);
  });

  it('Divide passes every Nth A and B restarts the count', () => {
    const l = make(5, 3);
    for (let i = 0; i < 6; i++) l.a(g(i));
    l.b(g(6));
    l.a(g(7));
    expect(l.out.map((e) => e.time)).toEqual([0, 3, 7]);
    expect(l.other).toHaveLength(4);
  });

  it('Toggle passes every other A', () => {
    const l = make(4);
    for (let i = 0; i < 4; i++) l.a(g(i));
    expect(l.out.map((e) => e.time)).toEqual([0, 2]);
  });
});

describe('Math', () => {
  it('operators', () => {
    expect(mathOp(0, 0.25, 0.5, 0)).toBe(0.75);
    expect(mathOp(2, 0.5, -0.5, 0)).toBe(-0.25);
    expect(mathOp(5, 0.6, 0.5, 0)).toBe(1);
    expect(mathOp(6, -0.4, 0, 0)).toBe(0.4);
    expect(fold(1.5)).toBeCloseTo(0.5);
    expect(fold(-1.5)).toBeCloseTo(-0.5);
  });

  it('slews jumps over Amount seconds', () => {
    const core = new MathCore();
    core.settings = { op: 8, gainA: 1, gainB: 1, offset: 0, amount: 0.5 };
    const a = new Float32Array(SR).fill(1);
    const out = new Float32Array(SR);
    core.process(a, undefined, out, SR);
    expect(out[Math.round(SR * 0.1)]).toBeGreaterThan(0.1);
    expect(out[Math.round(SR * 0.1)]).toBeLessThan(0.4);
    expect(out[SR - 1]).toBeCloseTo(1, 3);
  });
});

describe('Follower', () => {
  it('rises with a loud sound, opens the gate, and falls when it stops', () => {
    const core = new FollowerCore();
    core.settings = { attack: 0.002, release: 0.05, gain: 1, threshold: 0.3 };
    const loud = Float32Array.from({ length: SR / 10 }, (_, i) => Math.sin(i * 0.1) * 0.8);
    const out = new Float32Array(loud.length);
    const edges: FollowerEdge[] = [];
    core.process(loud, out, 0, SR, edges);
    expect(out[out.length - 1]).toBeGreaterThan(0.4);
    expect(edges[0]).toMatchObject({ rising: true });
    const quiet = new Float32Array(SR / 2);
    const out2 = new Float32Array(quiet.length);
    core.process(quiet, out2, loud.length, SR, edges);
    expect(out2[out2.length - 1]).toBeLessThan(0.01);
    expect(edges.at(-1)).toMatchObject({ rising: false });
  });
});

describe('Freq Shifter', () => {
  /** Strongest frequency in a signal, by a coarse DFT scan. */
  function peakHz(x: Float32Array, lo: number, hi: number): number {
    let best = 0;
    let bestHz = 0;
    for (let f = lo; f <= hi; f += 5) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < x.length; i++) {
        re += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
        im += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
      }
      const m = re * re + im * im;
      if (m > best) {
        best = m;
        bestHz = f;
      }
    }
    return bestHz;
  }

  it('moves a 1 kHz tone up by the shift', () => {
    const core = new ShifterCore();
    core.settings = { shift: 200, side: 0, feedback: 0, mix: 1 };
    const n = 8192;
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR));
    const out = new Float32Array(n);
    core.process(x, out, SR);
    expect(peakHz(out.slice(2048), 700, 1500)).toBe(1200);
    core.settings = { ...core.settings, side: 1 };
    core.process(x, out, SR);
    expect(peakHz(out.slice(2048), 500, 1500)).toBe(800);
  });
});

describe('Lanes', () => {
  it('paints one step and repairs bad data', () => {
    const d = lanesData.create();
    const next = paintLane(d, 2, 5, 0.9);
    expect(next.values[2][5]).toBe(0.9);
    expect(d.values[2][5]).not.toBe(0.9);
    expect(paintLane(d, 0, 0, 3).values[0][0]).toBe(1);
    const fixed = lanesData.normalize({ values: [[NaN, 2]] });
    expect(fixed.values[0][1]).toBe(1);
    expect(fixed.values).toHaveLength(4);
    expect(fixed.values[3]).toHaveLength(32);
  });
});

describe('Modal Perc', () => {
  it('every body rings, finitely, and stops', () => {
    for (let b = 0; b < BODIES.length; b++) {
      const synth = new PolySynth(SR, { ...defaultModalParams(), body: b, decay: 0.3 }, () => new ModalVoice(rng()), 2);
      synth.schedule({ time: 0, note: 48, velocity: 1, length: 0.1 });
      const out = new Float32Array(SR * 3);
      synth.process(out, 0, 1);
      const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      expect(Number.isFinite(peak), BODIES[b].name).toBe(true);
      expect(peak, BODIES[b].name).toBeGreaterThan(0.01);
      expect(synth.activeVoices, BODIES[b].name).toBe(0);
    }
  });

  it('soft materials damp the high modes faster', () => {
    expect(modeDecay(1, 4, 0)).toBeLessThan(modeDecay(1, 4, 1));
    expect(modeDecay(1, 1, 0)).toBeCloseTo(1);
    const r = stretchedRatios(2, 0.5);
    expect(r[1]).toBeGreaterThan(BODIES[2].ratios[1]);
  });
});

describe('Supersaw', () => {
  it('keeps its level about the same whatever the saw count', () => {
    for (const n of [1, 3, 7, 9]) {
      const g = sawGains(n, 0.6);
      expect(Math.hypot(...g)).toBeCloseTo(1, 6);
    }
    const peaks = [1, 9].map((voices) => {
      const synth = new PolySynth(SR, { ...defaultSupersawParams(), voices }, () => new SupersawVoice(rng()), 1);
      synth.schedule({ time: 0, note: 48, velocity: 1, length: 0.5 });
      const out = new Float32Array(SR / 2);
      synth.process(out, 0, 1);
      return Math.sqrt(out.reduce((s, x) => s + x * x, 0) / out.length);
    });
    expect(peaks[1] / peaks[0]).toBeGreaterThan(0.4);
    expect(peaks[1] / peaks[0]).toBeLessThan(2.5);
  });
});
