import { addModule, connect, createPatch, setCableAmount, setModuleData, setParam } from '../patch/model';
import type { ModuleDef, Patch } from '../patch/types';
import { factoryPresets } from './factory';
import { MATRIX_SIZE } from './matrix';
import { getDef } from './registry';

/** How tall a module's card is, so stacked modules don't overlap. */
export type CardHeight = (def: ModuleDef) => number;

/** A rough card height for when the canvas isn't there to say (tests, exports). */
const roughHeight: CardHeight = (d) => 60 + Math.max(d.inputs.length, d.outputs.length) * 28 + (d.face ?? []).length * 30 + (d.visual ? 200 : 0);

export interface Example {
  name: string;
  about: string;
  build(height?: CardHeight): Patch;
}

const COLUMN_WIDTH = 240;
const GAP = 50;

/** A builder that adds modules by short key and wires them by 'key.port > key.port'. */
function builder(name: string, height: CardHeight) {
  let patch = createPatch(name);
  const ids: Record<string, string> = {};
  const columns: number[] = [];
  const def = (type: string) => {
    const d = getDef(type);
    if (!d) throw new Error(`Missing module type ${type}`);
    return d;
  };
  return {
    /** Add a module at the bottom of a column. */
    add(key: string, type: string, column: number, params: Record<string, number> = {}, preset?: string) {
      const y = columns[column] ?? 0;
      columns[column] = y + height(def(type)) + GAP;
      const [p, m] = addModule(patch, def(type), column * COLUMN_WIDTH, y);
      patch = p;
      ids[key] = m.id;
      const fromPreset = preset ? factoryPresets(def(type)).find((f) => f.name === preset)?.params : undefined;
      if (preset && !fromPreset) throw new Error(`No factory preset ${preset} for ${type}`);
      for (const [k, v] of Object.entries({ ...fromPreset, ...params })) patch = setParam(patch, getDef, m.id, k, v);
    },
    data(key: string, data: unknown) {
      patch = setModuleData(patch, getDef, ids[key], data);
    },
    wire(...cables: string[]) {
      for (const c of cables) {
        const [[fm, fp], [tm, tp]] = c.split('>').map((s) => s.trim().split('.'));
        if (!ids[fm] || !ids[tm]) throw new Error(`Unknown module in ${c}`);
        [patch] = connect(patch, getDef, { module: ids[fm], port: fp }, { module: ids[tm], port: tp });
      }
    },
    /** A cable onto a setting, moving it by `amount`. */
    mod(from: string, to: string, param: string, amount: number) {
      const [fm, fp] = from.split('.');
      const [p, cable] = connect(patch, getDef, { module: ids[fm], port: fp }, { module: ids[to], port: `@${param}` });
      patch = setCableAmount(p, cable.id, amount);
    },
    get patch() {
      return patch;
    },
  };
}

/**
 * A starter in the manner of an Autechre Max patch: polymetric Euclidean
 * rings feed a chance matrix that decides, hit by hit, which voice plays;
 * one ring also steps a Markov melody, which the matrix splits between a
 * bell and a bass. A slow S&H plays a pad, a thinned Turing Machine scatters
 * a texture, and a Conductor keeps it all in D Phrygian while an LFO slowly
 * breathes its chance. Everything ends in a six-channel mixer.
 */
function autechreStarter(height: CardHeight = roughHeight): Patch {
  const b = builder('Autechre-style starter', height);
  // Sources and control.
  b.add('clock', 'clock', 0, { bpm: 118 });
  b.add('conductor', 'conductor', 0, { root: 2, scale: 4, chance: 0.9 });
  b.add('lfoPad', 'lfo', 0, { rate: 0.05, shape: 0 });
  b.add('lfoChance', 'lfo', 0, { rate: 0.03, shape: 1 });
  b.add('euclid', 'euclid', 1, {
    steps: 16, hits: 5, rotate: 0,
    steps2: 13, hits2: 3, rotate2: 4,
    on3: 1, steps3: 16, hits3: 11, rotate3: 0, speed3: 4,
    on4: 1, steps4: 7, hits4: 3, rotate4: 2,
  });
  b.add('sh', 'sh', 1, { mode: 1, step: 0.2, octave: 2 });
  b.add('turing', 'turing', 1, { length: 12, change: 0.15, density: 0.5, octave: 4 });
  b.add('thin', 'chance', 1, { chance: 0.3 });
  b.add('matrix', 'matrix', 2);
  b.add('markov', 'markov', 2, { size: 8, gate: 0.6 });
  // Voices.
  b.add('kick', 'drum', 3, {}, 'Sub kick');
  b.add('snare', 'drum', 3, {}, 'FM snare');
  b.add('hat', 'drum', 3, { level: 0.6 }, 'Closed hat');
  b.add('metal', 'drum', 3, { level: 0.6 }, 'Metal tick');
  b.add('bell', 'fm', 3, { level: 0.6 }, 'Cold bell');
  b.add('bass', 'lead', 3, {}, 'Acid FM bass');
  b.add('pad', 'pad', 4, {}, 'Dusk detune');
  b.add('texture', 'texture', 4, { level: 0.5 }, 'Granular choir');
  // Effects and mix.
  b.add('reverb', 'reverb', 4, { size: 4, mix: 0.6 });
  b.add('glitch', 'glitch', 4, { chance: 0.2 });
  b.add('delay', 'delay', 4, { mix: 0.4, feedback: 0.55 });
  b.add('mixer', 'mixer', 5, { level1: 0.9, level3: 0.6, pan3: 0.3, level4: 0.7, level5: 0.7, pan5: -0.3, level6: 0.7 });
  b.add('out', 'output', 5);

  // Which ring reaches which voice, crossing by crossing (rows are inputs, columns outputs, 0..100).
  const w = Array.from({ length: MATRIX_SIZE }, () => new Array<number>(MATRIX_SIZE).fill(0));
  w[0][0] = 100; // ring 1 → kick
  w[1][1] = 90; // ring 2 → snare, sometimes metal
  w[1][3] = 15;
  w[2][2] = 85; // ring 3 → hats
  w[3][3] = 50; // ring 4 → metal, and steps the Markov melody
  w[3][6] = 100;
  w[4][4] = 100; // melody → bell, now and then doubled by the bass
  w[4][5] = 30;
  b.data('matrix', { weights: w });

  b.wire(
    'clock.out > euclid.clock',
    'euclid.out > matrix.in1',
    'euclid.out2 > matrix.in2',
    'euclid.out3 > matrix.in3',
    'euclid.out4 > matrix.in4',
    'matrix.out7 > markov.clock',
    'markov.notes > matrix.in5',
    'matrix.out1 > kick.gate',
    'matrix.out2 > snare.gate',
    'matrix.out3 > hat.gate',
    'matrix.out4 > metal.gate',
    'matrix.out5 > bell.gate',
    'matrix.out6 > bass.gate',
    'clock.out > turing.clock',
    'turing.notes > thin.in',
    'thin.a > texture.gate',
    'markov.trig1 > sh.trig',
    'sh.notes > pad.gate',
    'kick.out > mixer.in1',
    'snare.out > glitch.in',
    'clock.out > glitch.clock',
    'glitch.out > mixer.in2',
    'hat.out > mixer.in3',
    'metal.out > mixer.in3',
    'bass.out > mixer.in4',
    'bell.out > delay.in',
    'delay.out > mixer.in5',
    'pad.out > reverb.in',
    'texture.out > reverb.in',
    'reverb.out > mixer.in6',
    'mixer.left > out.left',
    'mixer.right > out.right',
  );
  b.mod('lfoPad.out', 'pad', 'cutoff', 0.35);
  b.mod('lfoChance.out', 'conductor', 'chance', -0.3);
  return b.patch;
}

export const EXAMPLES: Example[] = [
  {
    name: 'Autechre-style starter',
    about: 'Euclidean rings through a chance matrix into FM drums, a Markov bell and bass, a pad and a texture, kept in key by a Conductor.',
    build: autechreStarter,
  },
];
