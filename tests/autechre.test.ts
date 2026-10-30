import { describe, expect, it } from 'vitest';
import { conduct, createGlobals, quantizeNote } from '../src/modules/conductor';
import { MATRIX_SIZE, matrixData, route } from '../src/modules/matrix';

describe('conductor', () => {
  it('moves notes to the nearest note of the scale, ties going up', () => {
    // C minor: C D Eb F G Ab Bb
    expect(quantizeNote(60, 0, 1)).toBe(60);
    expect(quantizeNote(64, 0, 1)).toBe(65); // E sits between Eb and F
    expect(quantizeNote(61, 0, 1)).toBe(62); // C# between C and D
    expect(quantizeNote(71, 0, 1)).toBe(72); // B goes up to the next C
    expect(quantizeNote(66, 2, 2)).toBe(66); // F# is in D major
  });

  it('leaves notes alone when off, and passes gates without a note', () => {
    const g = createGlobals();
    const e = { time: 0, note: 61, velocity: 1, duration: 0.1 };
    expect(conduct(g, e)).toBe(e);
    g.active = true;
    const trig = { time: 0, velocity: 1, duration: 0.1 };
    expect(conduct(g, trig)).toBe(trig);
  });

  it('transposes, quantizes and thins notes', () => {
    const g = { ...createGlobals(), active: true, scale: 1, transpose: 12, chance: 0.5 };
    const e = { time: 0, note: 61, velocity: 1, duration: 0.1 };
    expect(conduct(g, e, () => 0.2)?.note).toBe(74);
    expect(conduct(g, e, () => 0.7)).toBeNull();
  });
});

describe('matrix', () => {
  it('starts straight through and cleans bad data', () => {
    const d = matrixData.create();
    expect(d.weights[2][2]).toBe(100);
    expect(d.weights[2][3]).toBe(0);
    const n = matrixData.normalize({ weights: [[150, -3, 'x']] });
    expect(n.weights).toHaveLength(MATRIX_SIZE);
    expect(n.weights[0].slice(0, 3)).toEqual([100, 0, 0]);
  });

  it('rolls each crossing in Each mode', () => {
    const row = [100, 50, 0, 0, 0, 0, 0, 0];
    expect(route(row, 0, () => 0.3)).toEqual([0, 1]);
    expect(route(row, 0, () => 0.7)).toEqual([0]);
  });

  it('picks exactly one output in Pick one mode', () => {
    const row = [0, 0, 1, 0, 0, 0, 0, 3];
    expect(route(row, 1, () => 0)).toEqual([2]);
    expect(route(row, 1, () => 0.99)).toEqual([7]);
    expect(route(new Array(8).fill(0), 1)).toEqual([]);
  });
});
