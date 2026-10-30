import { GateOutput } from '../engine/gate';
import type { ModuleDataDef } from '../patch/types';
import { weightedPick } from './generative';
import type { ModuleType } from './types';

export const MATRIX_SIZE = 8;

export interface MatrixData {
  /** weights[input][output], 0..100: the chance (or, in Pick one mode, the odds) of an input's gate reaching an output. */
  weights: number[][];
}

/** Straight through to start with: input 1 to output 1, and so on. */
function diagonal(): number[][] {
  return Array.from({ length: MATRIX_SIZE }, (_, r) => Array.from({ length: MATRIX_SIZE }, (_, c) => (r === c ? 100 : 0)));
}

export const matrixData: ModuleDataDef<MatrixData> = {
  create: () => ({ weights: diagonal() }),
  normalize(raw) {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<MatrixData>;
    if (!Array.isArray(r.weights)) return { weights: diagonal() };
    return {
      weights: Array.from({ length: MATRIX_SIZE }, (_, i) =>
        Array.from({ length: MATRIX_SIZE }, (_, j) => {
          const v = Array.isArray(r.weights![i]) ? r.weights![i][j] : 0;
          return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
        }),
      ),
    };
  },
};

export const MATRIX_MODES = ['Each by chance', 'Pick one'];

/**
 * Where one input's gate goes: in Each mode every output rolls its own
 * chance; in Pick one mode exactly one output is chosen by the weights.
 */
export function route(row: number[], mode: number, random: () => number = Math.random): number[] {
  if (Math.round(mode) === 1) {
    if (!row.some((w) => w > 0)) return [];
    return [weightedPick(row, random)];
  }
  const out: number[] = [];
  row.forEach((w, j) => {
    if (w > 0 && random() * 100 < w) out.push(j);
  });
  return out;
}

/**
 * Routing matrix, like the one between the 16 sequencers and 16 synths in the
 * Autechre-inspired Max patch: each input's gates go to the outputs its row
 * points at, with a chance per crossing.
 */
export const matrix: ModuleType = {
  def: {
    type: 'matrix',
    label: 'Matrix',
    category: 'Generative',
    visual: true,
    description: 'Routes 8 gate inputs to 8 outputs. Each crossing has a chance; tap or drag the dials on the card.',
    inputs: Array.from({ length: MATRIX_SIZE }, (_, i) => ({ id: `in${i + 1}`, label: `In ${i + 1}`, kind: 'gate' as const })),
    outputs: Array.from({ length: MATRIX_SIZE }, (_, i) => ({ id: `out${i + 1}`, label: `Out ${i + 1}`, kind: 'gate' as const })),
    params: [{ id: 'mode', label: 'Mode', min: 0, max: 1, default: 0, step: 1, options: MATRIX_MODES }],
    face: ['mode'],
    data: matrixData as ModuleDataDef,
    presetScope: 'patch',
    presets: true,
  },
  create(_env, params, data) {
    const p = { ...params };
    let d = matrixData.normalize(data);
    const outs = Array.from({ length: MATRIX_SIZE }, () => new GateOutput());
    const history: { time: number; row: number; cols: number[] }[] = [];
    return {
      inputs: Object.fromEntries(
        Array.from({ length: MATRIX_SIZE }, (_, r) => [
          `in${r + 1}`,
          {
            kind: 'gate' as const,
            handler: (e: Parameters<GateOutput['emit']>[0]) => {
              const cols = route(d.weights[r], p.mode);
              for (const c of cols) outs[c].emit(e);
              history.push({ time: e.time, row: r, cols });
              if (history.length > 32) history.shift();
            },
          },
        ]),
      ),
      outputs: Object.fromEntries(outs.map((out, i) => [`out${i + 1}`, { kind: 'gate' as const, out }])),
      setParam(id, v) {
        p[id] = v;
      },
      setData(next) {
        d = matrixData.normalize(next);
      },
      getState(now) {
        // Crossings that fired in the last tenth of a second light up.
        const lit = history.filter((h) => h.time <= now && now - h.time < 0.1);
        return { weights: d.weights, lit: lit.flatMap((h) => h.cols.map((c) => h.row * MATRIX_SIZE + c)), rows: lit.map((h) => h.row) };
      },
      dispose() {},
    };
  },
};
