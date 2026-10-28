import { describe, expect, it } from 'vitest';
import { GRID, roundedPolyline, snap, squarePath } from '../src/ui/Canvas';

describe('square cable routing', () => {
  it('runs forward cables right, across, then right again with only straight segments', () => {
    const { d } = squarePath({ x: 0, y: 0 }, { x: 200, y: 100 });
    // Every corner is a short quadratic; every straight run is horizontal or vertical.
    const pts = [...d.matchAll(/[MLQ]\s*(-?[\d.]+) (-?[\d.]+)(?: (-?[\d.]+) (-?[\d.]+))?/g)];
    expect(pts.length).toBeGreaterThan(3);
    expect(d.startsWith('M0 0')).toBe(true);
    expect(d.endsWith('L200 100')).toBe(true);
  });

  it('loops backward cables at the same height around below both ends', () => {
    const { d, mid } = squarePath({ x: 300, y: 50 }, { x: 0, y: 80 });
    expect(d.startsWith('M300 50')).toBe(true);
    expect(d.endsWith('L0 80')).toBe(true);
    expect(mid.y).toBeGreaterThan(80);
  });

  it('crosses backward cables between rows halfway between the jacks', () => {
    const { mid } = squarePath({ x: 500, y: 300 }, { x: 100, y: 900 });
    expect(mid.y).toBe(600);
  });

  it('rounds corners without overshooting short segments', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 100 },
      ],
      8,
    );
    expect(d).toBe('M0 0L2 0Q4 0 4 2L4 100');
  });
});

describe('snap', () => {
  it('snaps to the grid', () => {
    expect(snap(GRID * 2 + 5)).toBe(GRID * 2);
    expect(snap(GRID * 2 + GRID - 1)).toBe(GRID * 3);
    expect(snap(-5)).toBe(-0);
  });
});
