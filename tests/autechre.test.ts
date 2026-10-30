import { describe, expect, it } from 'vitest';
import { conduct, createGlobals, quantizeNote } from '../src/modules/conductor';
import { MATRIX_SIZE, matrixData, route } from '../src/modules/matrix';
import { PatchRuntime } from '../src/engine/PatchRuntime';
import { getDef } from '../src/modules/registry';
import type { EngineEnv, ModuleType, RuntimeModule } from '../src/modules/types';
import { addModule, connect, createPatch, deserializePatch, setCableAmount, setParam } from '../src/patch/model';
import { capturePreset, MORPH, morphParam, morphParams, setMorph } from '../src/patch/presets';
import type { ModuleDef, ParamDef } from '../src/patch/types';

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

describe('preset morphing', () => {
  const cut: ParamDef = { id: 'cut', label: 'Cut', min: 20, max: 20000, default: 1000, curve: 'exp' };
  const mode: ParamDef = { id: 'mode', label: 'Mode', min: 0, max: 2, default: 0, step: 1, options: ['A', 'B', 'C'] };
  const level: ParamDef = { id: 'level', label: 'Level', min: 0, max: 1, default: 0.5 };
  const def: ModuleDef = { type: 'syn', label: 'Syn', inputs: [], outputs: [], params: [cut, mode, level, morphParam], presets: true };
  const bank = [
    { name: 'dark', params: { cut: 200, mode: 0, level: 0.2 } },
    { name: 'bright', params: { cut: 20000, mode: 2, level: 1 } },
  ];
  const own = { cut: 1000, mode: 1, level: 0.5, morph: 0 };

  it('glides along each slider and switches choices half way', () => {
    const half = morphParams(def, own, bank, { a: 0, b: 1 }, 0.5);
    expect(half.cut).toBeCloseTo(2000); // half way on an exponential slider
    expect(half.level).toBeCloseTo(0.6);
    expect(half.mode).toBe(1);
    expect(morphParams(def, own, bank, { a: 0, b: 1 }, 0)).toMatchObject(bank[0].params);
    expect(morphParams(def, own, bank, { a: 0, b: 1 }, 1)).toMatchObject(bank[1].params);
  });

  it('starts from the module’s own settings, and does nothing toward an empty slot', () => {
    expect(morphParams(def, own, bank, { a: null, b: 1 }, 0)).toMatchObject({ cut: 1000, level: 0.5 });
    expect(morphParams(def, own, bank, { a: null, b: 5 }, 0.7)).toBe(own);
    expect(morphParams(def, own, bank, undefined, 0.7)).toBe(own);
  });

  it('is offered on instruments with a preset library, saved, and kept out of presets', () => {
    expect(getDef('fm')!.params.some((p) => p.id === MORPH)).toBe(true);
    expect(getDef('lead')!.params.some((p) => p.id === MORPH)).toBe(true);
    expect(getDef('sequencer')!.params.some((p) => p.id === MORPH)).toBe(false);
    let [patch, fm] = addModule(createPatch(), getDef('fm')!);
    patch = setParam(patch, getDef, fm.id, MORPH, 0.4);
    patch = setMorph(patch, fm.id, { a: null, b: 2 });
    const back = deserializePatch(JSON.parse(JSON.stringify(patch)), getDef);
    expect(back.modules[0].morph).toEqual({ a: null, b: 2 });
    expect(capturePreset(back.modules[0], 'x').params[MORPH]).toBeUndefined();
    expect(setMorph(back, fm.id, null).modules[0].morph).toBeUndefined();
  });

  it('plays the morphed settings, and a cable on Morph sweeps them', () => {
    const set = new Map<string, number>();
    const syn: ModuleType = {
      def,
      create: (_env, params) => {
        for (const [k, v] of Object.entries(params)) set.set(k, v);
        return { inputs: {}, outputs: {}, setParam: (k: string, v: number) => set.set(k, v), dispose() {} } as unknown as RuntimeModule;
      },
    };
    const lfo: ModuleType = {
      def: { type: 'lfo', label: 'LFO', inputs: [], outputs: [{ id: 'out', label: 'Out', kind: 'cv' }], params: [] },
      create: () => ({ inputs: {}, outputs: { out: { kind: 'node', node: {} as AudioNode } }, setParam() {}, dispose() {} }) as unknown as RuntimeModule,
    };
    const types: Record<string, ModuleType> = { syn, lfo };
    const defs = (t: string) => types[t]?.def;
    let signal = 0;
    const rt = new PatchRuntime({} as EngineEnv, (t) => types[t], () => ({ read: () => signal, undo() {} }));
    let patch = createPatch();
    [patch] = addModule(patch, def, 0, 0, 's');
    patch = { ...patch, modules: patch.modules.map((m) => ({ ...m, presets: bank, params: { ...own } })) };
    // Patch-scoped here so the bank travels with the module.
    def.presetScope = 'patch';
    rt.sync(patch);
    expect(set.get('level')).toBe(0.5);

    patch = setMorph(patch, 's', { a: 0, b: 1 });
    rt.sync(patch);
    expect(set.get('level')).toBeCloseTo(0.2);
    patch = setParam(patch, defs, 's', MORPH, 0.5);
    rt.sync(patch);
    expect(set.get('level')).toBeCloseTo(0.6);
    expect(rt.modValues('s')?.get('level')).toBeCloseTo(0.6);

    [patch] = addModule(patch, lfo.def, 0, 0, 'l');
    [patch] = connect(patch, defs, { module: 'l', port: 'out' }, { module: 's', port: `@${MORPH}` });
    patch = setCableAmount(patch, patch.cables[0].id, 0.5);
    rt.sync(patch);
    signal = 1;
    rt.modulate();
    expect(set.get(MORPH)).toBeCloseTo(1);
    expect(set.get('level')).toBeCloseTo(1);

    patch = setMorph(patch, 's', null);
    rt.sync(patch);
    expect(set.get('level')).toBe(0.5);
  });
});
