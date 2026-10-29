import { describe, expect, it } from 'vitest';
import { LfoCore, lfoShape } from '../src/dsp/lfo';
import { PatchRuntime } from '../src/engine/PatchRuntime';
import { ClockFollower } from '../src/modules/lfo';
import { getDef } from '../src/modules/registry';
import type { EngineEnv, ModuleType, RuntimeModule } from '../src/modules/types';
import {
  addModule,
  connect,
  createPatch,
  DEFAULT_MOD_AMOUNT,
  deserializePatch,
  disconnect,
  hideParam,
  modulatedValue,
  PatchError,
  setCableAmount,
  setParam,
} from '../src/patch/model';
import type { ModuleDef, ParamDef } from '../src/patch/types';

const def = (t: string) => getDef(t)!;

function lfoIntoFm() {
  let p = createPatch();
  const [p1, lfo] = addModule(p, def('lfo'));
  const [p2, fm] = addModule(p1, def('fm'));
  const [p3, cable] = connect(p2, getDef, { module: lfo.id, port: 'out' }, { module: fm.id, port: '@op2Ratio' });
  p = p3;
  return { patch: p, lfo, fm, cable };
}

describe('cables into settings', () => {
  it('a cable onto a setting gives it a jack and a default amount', () => {
    const { patch, fm, cable } = lfoIntoFm();
    expect(cable.amount).toBe(DEFAULT_MOD_AMOUNT);
    expect(patch.modules.find((m) => m.id === fm.id)!.modJacks).toEqual(['op2Ratio']);
  });

  it('only real settings take cables', () => {
    const { patch, lfo, fm } = lfoIntoFm();
    expect(() => connect(patch, getDef, { module: lfo.id, port: 'out' }, { module: fm.id, port: '@nope' })).toThrow(PatchError);
  });

  it('amounts clamp, and removing a jack unplugs it', () => {
    const { patch, fm, cable } = lfoIntoFm();
    expect(setCableAmount(patch, cable.id, 3).cables[0].amount).toBe(1);
    const hidden = hideParam(patch, fm.id, 'op2Ratio');
    expect(hidden.cables).toHaveLength(0);
    expect(hidden.modules.find((m) => m.id === fm.id)!.modJacks).toBeUndefined();
  });

  it('jacks and amounts survive saving and loading', () => {
    const { patch, fm, cable } = lfoIntoFm();
    const saved = JSON.parse(JSON.stringify(setCableAmount(patch, cable.id, -0.6)));
    const back = deserializePatch(saved, getDef);
    expect(back.cables[0].to.port).toBe('@op2Ratio');
    expect(back.cables[0].amount).toBe(-0.6);
    expect(back.modules.find((m) => m.id === fm.id)!.modJacks).toEqual(['op2Ratio']);
  });

  it('moves along the slider, evenly on exponential ones, and clamps', () => {
    const lin: ParamDef = { id: 'a', label: 'A', min: 0, max: 1, default: 0.5, step: 0.01 };
    expect(modulatedValue(lin, 0.5, 0.25)).toBeCloseTo(0.75);
    expect(modulatedValue(lin, 0.5, 2)).toBe(1);
    const exp: ParamDef = { id: 'f', label: 'F', min: 1, max: 100, default: 10, curve: 'exp' };
    expect(modulatedValue(exp, 10, 0.5)).toBeCloseTo(100);
    expect(modulatedValue(exp, 10, -0.5)).toBeCloseTo(1);
  });
});

describe('runtime modulation', () => {
  function rig() {
    const set: [string, number][] = [];
    const param: ParamDef = { id: 'cut', label: 'Cut', min: 0, max: 1, default: 0.5, step: 0.001 };
    const mk = (d: Partial<ModuleDef>, onSet?: (id: string, v: number) => void): ModuleType => ({
      def: { type: d.type!, label: d.type!, inputs: [], outputs: [], params: [], ...d },
      create: () =>
        ({
          inputs: {},
          outputs: { out: { kind: 'node', node: {} as AudioNode } },
          setParam: (id: string, v: number) => onSet?.(id, v),
          dispose() {},
        }) as unknown as RuntimeModule,
    });
    const types: Record<string, ModuleType> = {
      src: mk({ type: 'src', outputs: [{ id: 'out', label: 'Out', kind: 'cv' }] }),
      dst: mk({ type: 'dst', params: [param] }, (id, v) => set.push([id, v])),
    };
    let level = 0;
    const rt = new PatchRuntime({} as EngineEnv, (t) => types[t], () => ({ read: () => level, undo() {} }));
    const defs = (t: string) => types[t]?.def;
    let patch = createPatch();
    [patch] = addModule(patch, types.src.def, 0, 0, 's');
    [patch] = addModule(patch, types.dst.def, 0, 0, 'd');
    const [withCable, cable] = connect(patch, defs, { module: 's', port: 'out' }, { module: 'd', port: '@cut' });
    return { rt, set, defs, patch: setCableAmount(withCable, cable.id, 0.5), plain: patch, cable, setLevel: (v: number) => (level = v) };
  }

  it('adds signal × amount to the setting, and lets go when unplugged', () => {
    const r = rig();
    r.rt.sync(r.patch);
    r.setLevel(0.4);
    r.rt.modulate();
    expect(r.set.at(-1)![0]).toBe('cut');
    expect(r.set.at(-1)![1]).toBeCloseTo(0.7);
    expect(r.rt.modValues('d')?.get('cut')).toBeCloseTo(0.7);

    // Moving the slider while modulated shifts the centre the signal swings around.
    const moved = setParam(r.patch, r.defs, 'd', 'cut', 0.2);
    r.rt.sync(moved);
    r.rt.modulate();
    expect(r.set.at(-1)![1]).toBeCloseTo(0.4);

    r.rt.sync(disconnect(moved, r.cable.id));
    r.rt.modulate();
    expect(r.set.at(-1)).toEqual(['cut', 0.2]);
    expect(r.rt.modValues('d')).toBeUndefined();
  });
});

describe('LFO', () => {
  it('draws its shapes', () => {
    expect(lfoShape(0, 0.25)).toBeCloseTo(1);
    expect(lfoShape(1, 0.25)).toBeCloseTo(1);
    expect(lfoShape(1, 0.75)).toBeCloseTo(-1);
    expect(lfoShape(2, 0)).toBe(-1);
    expect(lfoShape(4, 0.75)).toBe(-1);
    expect(lfoShape(6, 0.5, 0, 1)).toBeCloseTo(0.5);
  });

  it('runs at its rate, resets on time, and can be unipolar', () => {
    const lfo = new LfoCore(100);
    lfo.settings = { rate: 1, shape: 2, unipolar: false, level: 1 };
    const out = new Float32Array(50);
    lfo.process(out, 0);
    expect(out[0]).toBeCloseTo(-1);
    expect(out[25]).toBeCloseTo(-0.5);
    lfo.schedule({ time: 0.6 });
    lfo.schedule({ time: 0.6, reset: true });
    lfo.process(out, 50);
    expect(out[10]).toBeCloseTo(-1);
    lfo.settings.unipolar = true;
    lfo.process(out, 100);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
  });

  it('follows a clock: rate from the tick spacing, a new cycle every N ticks', () => {
    const f = new ClockFollower();
    expect(f.tick(0, 4)).toEqual({ rate: null, reset: true });
    expect(f.tick(0.5, 4)).toEqual({ rate: 0.5, reset: false });
    f.tick(1, 4);
    f.tick(1.5, 4);
    expect(f.tick(2, 4).reset).toBe(true);
  });
});
