import { GateOutput } from '../engine/gate';
import type { ModuleDataDef } from '../patch/types';
import { cvSource, PITCH_PARAMS, scaleNote } from './util';
import type { ModuleType } from './types';

export const LIFE_ROWS = 12;
export const LIFE_COLS = 16;
const CELLS = LIFE_ROWS * LIFE_COLS;

export interface LifeData {
  /** The starting grid you draw, row by row, 1 = alive. Reset brings it back. */
  cells: number[];
}

/** A glider and a blinker, so a fresh module does something right away. */
function defaultCells(): number[] {
  const c = Array(CELLS).fill(0);
  const set = (r: number, col: number) => (c[r * LIFE_COLS + col] = 1);
  [[1, 2], [2, 3], [3, 1], [3, 2], [3, 3]].forEach(([r, col]) => set(r, col));
  [[7, 9], [7, 10], [7, 11]].forEach(([r, col]) => set(r, col));
  [[5, 12], [6, 13], [6, 12], [5, 13]].forEach(([r, col]) => set(r, col));
  return c;
}

export const lifeData: ModuleDataDef<LifeData> = {
  create: () => ({ cells: defaultCells() }),
  normalize(raw) {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<LifeData>;
    if (!Array.isArray(r.cells)) return { cells: defaultCells() };
    return { cells: Array.from({ length: CELLS }, (_, i) => (r.cells![i] ? 1 : 0)) };
  },
};

/** One generation of Conway's Game of Life on a grid that wraps at the edges. */
export function lifeStep(cells: number[], rows = LIFE_ROWS, cols = LIFE_COLS): { cells: number[]; births: number; deaths: number } {
  const next = Array(rows * cols).fill(0);
  let births = 0;
  let deaths = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr || dc) n += cells[((r + dr + rows) % rows) * cols + ((c + dc + cols) % cols)];
        }
      }
      const i = r * cols + c;
      const alive = cells[i] === 1;
      const lives = alive ? n === 2 || n === 3 : n === 3;
      next[i] = lives ? 1 : 0;
      if (lives && !alive) births++;
      if (!lives && alive) deaths++;
    }
  }
  return { cells: next, births, deaths };
}

export function randomCells(density: number, random: () => number = Math.random): number[] {
  return Array.from({ length: CELLS }, () => (random() < density ? 1 : 0));
}

/** Rows that are alive in a column, top row first. */
export function liveRows(cells: number[], col: number): number[] {
  const rows: number[] = [];
  for (let r = 0; r < LIFE_ROWS; r++) if (cells[r * LIFE_COLS + col]) rows.push(r);
  return rows;
}

export const LIFE_EVOLVE = ['Each pass', 'Each step'];

interface Frame {
  time: number;
  cells: number[];
  col: number;
}

/**
 * Conway's Game of Life as a sequencer. A scan line sweeps the columns one
 * per clock and plays the live cells it crosses (higher rows, higher notes).
 * The grid evolves each pass (or each step); births and deaths fire gates and
 * the population comes out as CV.
 */
export const life: ModuleType = {
  def: {
    type: 'life',
    label: 'Game of Life',
    category: 'Generative',
    description: 'Cells live and die by Conway\'s rules. A scan line plays the live cells as notes; births fire gates; population is CV.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: [
      { id: 'notes', label: 'Notes', kind: 'gate' },
      { id: 'births', label: 'Births', kind: 'gate' },
      { id: 'deaths', label: 'Deaths', kind: 'gate' },
      { id: 'pop', label: 'Population', kind: 'cv' },
    ],
    params: [
      { id: 'evolve', label: 'Evolve', min: 0, max: 1, default: 0, step: 1, options: LIFE_EVOLVE },
      { id: 'voices', label: 'Max notes', min: 1, max: 6, default: 3, step: 1 },
      { id: 'reseed', label: 'Reseed', min: 0, max: 1, default: 1, step: 1, options: ['Off', 'When stuck'] },
      { id: 'density', label: 'Seed density', min: 0.05, max: 0.6, default: 0.25, step: 0.01 },
      ...PITCH_PARAMS,
    ],
    face: ['evolve'],
    groups: [
      { label: 'Life', params: ['evolve', 'voices', 'reseed', 'density'] },
      { label: 'Notes', params: ['scale', 'root', 'octave'] },
    ],
    data: lifeData as ModuleDataDef,
    presetScope: 'patch',
    presets: true,
  },
  create({ ctx }, params, data) {
    const p = { ...params };
    let seed = lifeData.normalize(data).cells;
    let cells = seed.slice();
    let older: number[] = [];
    let col = -1;
    const outs = { notes: new GateOutput(), births: new GateOutput(), deaths: new GateOutput() };
    const pop = cvSource(ctx);
    const frames: Frame[] = [];

    const evolve = (time: number, length: number) => {
      const prev = cells;
      const g = lifeStep(cells);
      cells = g.cells;
      if (g.births) outs.births.emit({ time, value: Math.min(1, 0.4 + g.births / 12), length });
      if (g.deaths) outs.deaths.emit({ time, value: Math.min(1, 0.4 + g.deaths / 12), length });
      // A dead or frozen (still or blinking) grid would go quiet forever; throw in new life.
      const stuck = cells.every((v) => !v) || cells.every((v, i) => v === prev[i]) || cells.every((v, i) => v === older[i]);
      if (stuck && p.reseed) cells = randomCells(p.density);
      older = prev;
    };

    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) => {
            col = (col + 1) % LIFE_COLS;
            if (Math.round(p.evolve) === 1 || (col === 0 && frames.length)) evolve(e.time, e.length);
            const rows = liveRows(cells, col);
            // Busy columns play their highest notes, up to the voice limit.
            for (const r of rows.slice(0, Math.round(p.voices))) {
              outs.notes.emit({ time: e.time, value: 0.75, length: e.length, note: scaleNote(LIFE_ROWS - 1 - r, p) });
            }
            pop.set(cells.reduce((s, v) => s + v, 0) / CELLS, e.time);
            frames.push({ time: e.time, cells, col });
            if (frames.length > 8) frames.shift();
          },
        },
        reset: {
          kind: 'gate',
          handler: () => {
            cells = seed.slice();
            col = -1;
          },
        },
      },
      outputs: {
        notes: { kind: 'gate', out: outs.notes },
        births: { kind: 'gate', out: outs.births },
        deaths: { kind: 'gate', out: outs.deaths },
        pop: { kind: 'node', node: pop.node },
      },
      setParam(id, v) {
        p[id] = v;
      },
      setData(next) {
        // Drawing on the grid restarts it from the drawing.
        seed = lifeData.normalize(next).cells;
        cells = seed.slice();
      },
      getState(now) {
        let f: Frame | undefined;
        for (const fr of frames) if (fr.time <= now) f = fr;
        return f ? { cells: f.cells, col: f.col } : { cells, col: -1 };
      },
      dispose: pop.dispose,
    };
  },
};
