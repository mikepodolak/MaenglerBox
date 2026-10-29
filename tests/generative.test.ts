import { describe, expect, it } from 'vitest';
import { TriggerDetector } from '../src/dsp/trigger';
import type { GateEvent } from '../src/engine/gate';
import { BallSim, SIM_DT } from '../src/modules/balls';
import {
  chanceGate,
  chanceRoute,
  euclid,
  euclidHit,
  nextHeld,
  probability,
  turingStep,
  turingValue,
  weightedPick,
} from '../src/modules/generative';
import { LIFE_COLS, LIFE_ROWS, life, lifeData, lifeStep, liveRows } from '../src/modules/life';
import { markov, markovData, markovNext } from '../src/modules/markov';
import { allDefs } from '../src/modules/registry';
import type { EngineEnv, RuntimeModule } from '../src/modules/types';
import { scaleNote, unitToNote } from '../src/modules/util';
import { canConnect, defaultParams } from '../src/patch/model';
import { MODULE_CATEGORIES } from '../src/patch/types';

/** Just enough of an AudioContext for modules that only use constant sources. */
function fakeEnv(): EngineEnv {
  const param = () => ({ value: 0, setValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  const ctx = {
    currentTime: 0,
    createConstantSource: () => ({ offset: param(), start() {}, stop() {}, connect() {}, disconnect() {} }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, scheduler: { add: () => () => {} } as never, master: {} as AudioNode };
}

function listen(rt: RuntimeModule, port: string): GateEvent[] {
  const got: GateEvent[] = [];
  const src = rt.outputs[port];
  if (src.kind !== 'gate') throw new Error(`${port} is not a gate`);
  src.out.connect((e) => got.push(e));
  return got;
}

function clock(rt: RuntimeModule, n: number, port = 'clock'): void {
  const inp = rt.inputs[port];
  if (inp.kind !== 'gate') throw new Error('not a gate input');
  for (let i = 0; i < n; i++) inp.handler({ time: i * 0.125, value: 1, length: 0.0625 });
}

/** Repeats a fixed list of numbers as a random source. */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('any output into any input', () => {
  it('allows gate↔cv and gate↔audio cables', () => {
    expect(canConnect('gate', 'cv')).toBe(true);
    expect(canConnect('cv', 'gate')).toBe(true);
    expect(canConnect('audio', 'gate')).toBe(true);
  });

  it('turns a rising signal into one trigger, with hysteresis', () => {
    const d = new TriggerDetector();
    const sig = Float32Array.from([0, 0.2, 0.6, 0.9, 0.45, 0.6, 0.1, 0.8]);
    // 0.45 is not below the 0.25 low threshold, so 0.6 after it is not a new edge.
    expect(d.process(sig, 100)).toEqual([
      { frame: 102, value: expect.closeTo(0.6, 5) },
      { frame: 107, value: expect.closeTo(0.8, 5) },
    ]);
  });

  it('keeps its state across blocks', () => {
    const d = new TriggerDetector();
    expect(d.process(Float32Array.from([0, 1]), 0)).toHaveLength(1);
    expect(d.process(Float32Array.from([1, 1]), 2)).toHaveLength(0);
  });
});

describe('module list', () => {
  it('puts every module in a known category', () => {
    for (const d of allDefs()) expect(MODULE_CATEGORIES).toContain(d.category);
  });
});

describe('pitch helpers', () => {
  it('walks a scale through octaves', () => {
    const p = { scale: 1, root: 0, octave: 3 }; // C minor from C3 (48)
    expect([0, 1, 2, 7].map((d) => scaleNote(d, p))).toEqual([48, 50, 51, 60]);
  });

  it('maps 0..1 across the range', () => {
    const p = { scale: 1, root: 0, octave: 3 };
    expect(unitToNote(0, 1, p)).toBe(48);
    expect(unitToNote(1, 1, p)).toBe(58);
  });
});

describe('Chance Gate', () => {
  it('routes by chance', () => {
    expect(chanceRoute(0.5, () => 0.2)).toBe('a');
    expect(chanceRoute(0.5, () => 0.7)).toBe('b');
    expect(chanceRoute(0, () => 0)).toBe('b');
  });

  it('passes the whole event through, note and all', () => {
    const rt = chanceGate.create(fakeEnv(), { chance: 1 }, undefined);
    const a = listen(rt, 'a');
    const inp = rt.inputs.in;
    if (inp.kind === 'gate') inp.handler({ time: 1, value: 0.5, length: 0.1, note: 60 });
    expect(a).toEqual([{ time: 1, value: 0.5, length: 0.1, note: 60 }]);
  });
});

describe('Probability', () => {
  it('picks by weight', () => {
    expect(weightedPick([1, 0, 3], () => 0.1)).toBe(0);
    expect(weightedPick([1, 0, 3], () => 0.3)).toBe(2);
    expect(weightedPick([0, 0, 0, 0], () => 0.6)).toBe(2);
  });

  it('sends the pick as a preset number on Notes', () => {
    const rt = probability.create(fakeEnv(), { w1: 0, w2: 0, w3: 1, w4: 0 }, undefined);
    const notes = listen(rt, 'notes');
    const three = listen(rt, 'out3');
    clock(rt, 2, 'trig');
    expect(three).toHaveLength(2);
    expect(notes.map((e) => e.index)).toEqual([3, 3]);
  });
});

describe('Euclidean', () => {
  const pattern = (hits: number, steps: number, rot = 0) =>
    Array.from({ length: steps }, (_, i) => (euclidHit(i, hits, steps, rot) ? 'x' : '.')).join('');

  it('spreads hits evenly', () => {
    expect(pattern(4, 16)).toBe('x...x...x...x...');
    expect(pattern(3, 8)).toBe('x..x..x.');
    expect(pattern(5, 8).split('').filter((c) => c === 'x')).toHaveLength(5);
    expect(pattern(0, 8)).toBe('........');
    expect(pattern(9, 8)).toBe('xxxxxxxx');
  });

  it('rotates', () => {
    expect(pattern(3, 8, 1)).toBe('.x..x..x');
  });

  it('plays hits and rests on separate outputs, accenting the downbeat', () => {
    const rt = euclid.create(fakeEnv(), { ...defaultParams(euclid.def), steps: 8, hits: 3 }, undefined);
    const hits = listen(rt, 'out');
    const off = listen(rt, 'off');
    clock(rt, 8);
    expect(hits.map((e) => e.time / 0.125)).toEqual([0, 3, 6]);
    expect(off).toHaveLength(5);
    expect(hits[0].value).toBe(1);
    expect(hits[1].value).toBeCloseTo(0.7);
  });
});

describe('Turing Machine', () => {
  const bits = (s: string) => s.split('').map((c) => c === '1');
  const str = (b: boolean[]) => b.map((x) => (x ? '1' : '0')).join('');

  it('loops unchanged at change 0', () => {
    let b = bits('1100000000000000');
    for (let i = 0; i < 4; i++) b = turingStep(b, 4, 0, () => 0.5);
    expect(str(b)).toBe('1100000000000000');
    b = turingStep(b, 4, 0, () => 0.5);
    expect(str(b)).toBe('0110000000000000');
  });

  it('flips the bit coming round at change 1', () => {
    const b = turingStep(bits('0001000000000000'), 4, 1, () => 0);
    expect(str(b)).toBe('0000000000000000');
  });

  it('reads the first byte as a value', () => {
    expect(turingValue(bits('1111111100000000'))).toBe(1);
    expect(turingValue(bits('0000000011111111'))).toBe(0);
  });
});

describe('Sample & Hold', () => {
  it('walks within 0..1', () => {
    expect(nextHeld(0.5, 1, 0.1, () => 1)).toBeCloseTo(0.6);
    expect(nextHeld(0.95, 1, 0.1, () => 1)).toBeCloseTo(0.95); // bounced off the top
    expect(nextHeld(0.5, 0, 0.1, () => 0.25)).toBe(0.25);
  });
});

describe('Markov Chain', () => {
  it('moves by the weights in the current row', () => {
    const w = [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ];
    expect(markovNext(w, 0, 3, () => 0.5)).toBe(1);
    expect(markovNext(w, 1, 3, () => 0.5)).toBe(2);
    expect(markovNext(w, 2, 3, () => 0.5)).toBe(0);
  });

  it('jumps anywhere from a row with no way out', () => {
    expect(markovNext([[0, 0, 0, 0]], 0, 4, () => 0.8)).toBe(3);
  });

  it('ignores states beyond the size', () => {
    expect(markovNext([[0, 1, 9]], 0, 2, () => 0.99)).toBe(1);
  });

  it('repairs bad data', () => {
    const d = markovData.normalize({ weights: [[200, -1]], states: [{ note: 500, repeat: 0 }] });
    expect(d.weights[0].slice(0, 2)).toEqual([100, 0]);
    expect(d.weights).toHaveLength(16);
    expect(d.states[0]).toEqual({ note: 127, repeat: 1, mute: false });
  });

  it('plays a walk, holding states by their repeat count, and tags notes with the state', () => {
    const data = markovData.create();
    data.weights = data.weights.map((row, r) => row.map((_, c) => (c === (r + 1) % 3 ? 1 : 0)));
    data.states[1] = { ...data.states[1], repeat: 2 };
    data.states[2] = { ...data.states[2], mute: true };
    const rt = markov.create(fakeEnv(), { size: 3, gate: 0.5, transpose: 0 }, data);
    const notes = listen(rt, 'notes');
    clock(rt, 6);
    // States: 1, 2, 2, 3 (muted), 1, 2
    expect(notes.map((e) => e.index)).toEqual([1, 2, 2, 1, 2]);
    expect(notes[0].note).toBe(data.states[0].note);
  });
});

describe('Game of Life', () => {
  const grid = (cells: [number, number][]) => {
    const c = Array(LIFE_ROWS * LIFE_COLS).fill(0);
    for (const [r, col] of cells) c[r * LIFE_COLS + col] = 1;
    return c;
  };

  it('blinks a blinker', () => {
    const g = lifeStep(grid([[5, 4], [5, 5], [5, 6]]));
    expect(g.cells).toEqual(grid([[4, 5], [5, 5], [6, 5]]));
    expect(g.births).toBe(2);
    expect(g.deaths).toBe(2);
  });

  it('wraps at the edges', () => {
    const g = lifeStep(grid([[0, 0], [0, 1], [0, LIFE_COLS - 1]]));
    expect(g.cells[(LIFE_ROWS - 1) * LIFE_COLS + 0]).toBe(1);
  });

  it('lists live rows in a column', () => {
    expect(liveRows(grid([[2, 3], [7, 3], [2, 4]]), 3)).toEqual([2, 7]);
  });

  it('plays the scan column, higher rows higher, up to the voice limit', () => {
    const data = { cells: grid([[0, 0], [5, 0], [11, 0], [3, 0], [4, 3]]) };
    const rt = life.create(fakeEnv(), { ...defaultParams(life.def), voices: 2, reseed: 0 }, data);
    const notes = listen(rt, 'notes');
    clock(rt, 1);
    expect(notes).toHaveLength(2);
    expect(notes[0].note!).toBeGreaterThan(notes[1].note!);
  });

  it('evolves once per pass and fires births', () => {
    const data = { cells: grid([[5, 4], [5, 5], [5, 6]]) };
    const rt = life.create(fakeEnv(), { ...defaultParams(life.def), reseed: 0 }, data);
    const births = listen(rt, 'births');
    clock(rt, LIFE_COLS);
    expect(births).toHaveLength(0);
    clock(rt, 1);
    expect(births).toHaveLength(1);
  });

  it('keeps a drawn grid through normalize', () => {
    const cells = grid([[1, 1]]);
    expect(lifeData.normalize({ cells }).cells).toEqual(cells);
  });
});

describe('Bouncing Balls', () => {
  it('bounces forever at bounce 1, hitting the floor at a steady rate', () => {
    const sim = new BallSim({ count: 1, gravity: 1, bounce: 1, size: 0.05 }, () => 0.5);
    sim.balls[0].vx = 0;
    const times: number[] = [];
    for (let i = 0; i < 240 * 10; i++) {
      for (const h of sim.step(SIM_DT)) if (h.kind === 'floor') times.push(i * SIM_DT);
    }
    expect(times.length).toBeGreaterThan(4);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 1);
  });

  it('settles when bounce is low, then a kick wakes it', () => {
    const sim = new BallSim({ count: 1, gravity: 1, bounce: 0.5, size: 0.05 }, () => 0.5);
    for (let i = 0; i < 240 * 5; i++) sim.step(SIM_DT);
    let hits = 0;
    for (let i = 0; i < 240; i++) hits += sim.step(SIM_DT).length;
    expect(hits).toBe(0);
    sim.kick();
    for (let i = 0; i < 240 * 2; i++) hits += sim.step(SIM_DT).length;
    expect(hits).toBeGreaterThan(0);
  });

  it('collides balls with each other', () => {
    const sim = new BallSim({ count: 2, gravity: 0, bounce: 1, size: 0.05 }, () => 0.5);
    sim.balls[0] = { x: 0.3, y: 0.5, vx: 1, vy: 0 };
    sim.balls[1] = { x: 0.7, y: 0.5, vx: -1, vy: 0 };
    const kinds: string[] = [];
    for (let i = 0; i < 60; i++) kinds.push(...sim.step(SIM_DT).map((h) => h.kind));
    expect(kinds).toContain('ball');
    expect(sim.balls[0].vx).toBeLessThan(0);
    expect(sim.balls[1].vx).toBeGreaterThan(0);
  });

  it('keeps balls inside the box', () => {
    const sim = new BallSim({ count: 6, gravity: 2, bounce: 1.05, size: 0.08 }, seq(0.1, 0.9, 0.4, 0.7, 0.2));
    for (let i = 0; i < 240 * 20; i++) sim.step(SIM_DT);
    for (const b of sim.balls) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(1);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(1);
    }
  });
});
