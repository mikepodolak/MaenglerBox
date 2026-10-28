import { describe, expect, it } from 'vitest';
import { Scheduler } from '../src/engine/Scheduler';
import { GateOutput } from '../src/engine/gate';
import { clockTicks } from '../src/modules/core';
import { fromNormalized, toNormalized } from '../src/patch/params';
import { getDef } from '../src/modules/registry';

describe('Scheduler', () => {
  it('hands out contiguous, non-overlapping windows', () => {
    let now = 0;
    const s = new Scheduler({ now: () => now, lookahead: 0.1, setTimer: () => 1, clearTimer: () => {} });
    const windows: [number, number][] = [];
    s.add((a, b) => windows.push([a, b]));
    s.start();
    now = 0.025;
    s.tick();
    now = 0.05;
    s.tick();
    expect(windows).toEqual([
      [0, 0.1],
      [0.1, 0.125],
      [0.125, 0.15000000000000002],
    ]);
  });

  it('skips ahead after a stall instead of scheduling the past', () => {
    let now = 0;
    const s = new Scheduler({ now: () => now, lookahead: 0.1, setTimer: () => 1, clearTimer: () => {} });
    const windows: [number, number][] = [];
    s.add((a, b) => windows.push([a, b]));
    s.start();
    now = 5;
    s.tick();
    expect(windows[1][0]).toBe(5);
  });
});

describe('clockTicks', () => {
  it('emits each tick exactly once across windows', () => {
    const all: number[] = [];
    let next = 0;
    for (let i = 0; i < 10; i++) {
      const r = clockTicks(next, i / 10, (i + 1) / 10, 0.125);
      all.push(...r.ticks);
      next = r.next;
    }
    expect(all.map((x) => +x.toFixed(6))).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
  });

  it('catches up without emitting late ticks', () => {
    const r = clockTicks(0, 1.01, 1.2, 0.125);
    expect(r.ticks.map((x) => +x.toFixed(6))).toEqual([1.125]);
  });
});

describe('GateOutput', () => {
  it('fans out to connected handlers and stops after disconnect', () => {
    const out = new GateOutput();
    const got: number[] = [];
    const off = out.connect((e) => got.push(e.time));
    out.emit({ time: 1, value: 1, length: 0.1 });
    off();
    out.emit({ time: 2, value: 1, length: 0.1 });
    expect(got).toEqual([1]);
  });
});

describe('param mapping', () => {
  it('round-trips exponential params', () => {
    const freq = getDef('oscillator')!.params.find((p) => p.id === 'freq')!;
    expect(fromNormalized(freq, toNormalized(freq, 440))).toBeCloseTo(440, 6);
    expect(fromNormalized(freq, 0)).toBe(20);
    expect(fromNormalized(freq, 1)).toBe(8000);
  });

  it('snaps stepped params', () => {
    const wave = getDef('oscillator')!.params.find((p) => p.id === 'wave')!;
    expect(fromNormalized(wave, 0.4)).toBe(1);
  });
});
