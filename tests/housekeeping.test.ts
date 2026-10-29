import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppStore } from '../src/app/store';
import { euclid, ringParam, turingLoop, turingValue } from '../src/modules/generative';
import { HELP } from '../src/modules/help';
import { allDefs, getDef } from '../src/modules/registry';
import { addModule, createPatch, defaultParams, deserializePatch, resizeModule } from '../src/patch/model';
import { applyRecipe } from '../src/patch/recipes';
import type { GateEvent } from '../src/engine/gate';
import type { EngineEnv } from '../src/modules/types';
import { defaultPatch } from '../src/patch/defaultPatch';

const env = { ctx: {} as BaseAudioContext, scheduler: { add: () => () => {} } as never, master: {} as AudioNode } as EngineEnv;

describe('module help', () => {
  it('covers every module, and names only real jacks and settings', () => {
    for (const d of allDefs()) {
      const help = HELP[d.type];
      expect(help, d.type).toBeDefined();
      for (const id of Object.keys(help.inputs ?? {})) expect(d.inputs.map((p) => p.id), `${d.type} input ${id}`).toContain(id);
      for (const id of Object.keys(help.outputs ?? {})) expect(d.outputs.map((p) => p.id), `${d.type} output ${id}`).toContain(id);
      for (const id of Object.keys(help.settings ?? {})) expect(d.params.map((p) => p.id), `${d.type} setting ${id}`).toContain(id);
    }
  });

  it('every recipe adds cleanly to an empty patch and to the starter patch', () => {
    for (const [type, help] of Object.entries(HELP)) {
      for (const idea of help.ideas ?? []) {
        if (!idea.recipe) continue;
        for (const base of [createPatch(), defaultPatch(getDef)]) {
          const r = applyRecipe(base, getDef, idea.recipe, { x: 0, y: 0 });
          expect(r.patch.cables.length - base.cables.length, `${type}: ${idea.title}`).toBe(idea.recipe.cables.length);
          if ('self' in idea.recipe.modules) expect(r.patch.modules.find((m) => m.id === r.selfId)?.type).toBe(type);
        }
      }
    }
  });

  it('reuses the patch clock and output instead of adding new ones', () => {
    const base = defaultPatch(getDef);
    const r = applyRecipe(base, getDef, HELP.turing.ideas![0].recipe!, { x: 0, y: 0 });
    expect(r.patch.modules.filter((m) => m.type === 'clock')).toHaveLength(1);
    expect(r.patch.modules.filter((m) => m.type === 'output')).toHaveLength(1);
    expect(r.patch.modules.find((m) => m.id === r.selfId)!.params.change).toBe(0.05);
  });
});

describe('resizable cards', () => {
  it('clamps the width and keeps it through save and load', () => {
    let [p, m] = addModule(createPatch(), getDef('balls')!);
    p = resizeModule(p, m.id, 2000);
    expect(p.modules[0].width).toBe(640);
    const back = deserializePatch(JSON.parse(JSON.stringify(p)), getDef);
    expect(back.modules[0].width).toBe(640);
  });
});

describe('Euclidean rings', () => {
  it('keeps ring 1 on the old ids and adds rings 2–4', () => {
    expect(ringParam('steps', 0)).toBe('steps');
    expect(ringParam('steps', 2)).toBe('steps3');
    const ids = euclid.def.params.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['steps', 'hits', 'rotate', 'steps2', 'on2', 'note4', 'speed3']));
  });

  it('plays each ring on its own output and all of them on Notes, at their speeds', () => {
    const p = { ...defaultParams(euclid.def), steps: 4, hits: 4, steps2: 4, hits2: 4, on2: 1, speed2: 2 /* ÷2 */, on3: 1, steps3: 2, hits3: 2, speed3: 4 /* ×2 */ };
    const rt = euclid.create(env, p, undefined);
    const got: Record<string, GateEvent[]> = {};
    for (const port of ['out', 'out2', 'out3', 'notes']) {
      got[port] = [];
      const o = rt.outputs[port];
      if (o.kind === 'gate') o.out.connect((e) => got[port].push(e));
    }
    const clock = rt.inputs.clock;
    if (clock.kind === 'gate') for (let i = 0; i < 4; i++) clock.handler({ time: i, value: 1, length: 0.5 });
    expect(got.out).toHaveLength(4);
    expect(got.out2).toHaveLength(2);
    expect(got.out3).toHaveLength(8);
    expect(got.out3.map((e) => e.time).slice(0, 2)).toEqual([0, 0.5]);
    expect(got.notes).toHaveLength(14);
    expect(new Set(got.notes.map((e) => e.index))).toEqual(new Set([1, 2, 3]));
  });
});

describe('Turing pad grid', () => {
  it('puts the playing value in the playing column, and the next values after it', () => {
    const bits = '1011000000000000'.split('').map((c) => c === '1');
    const loop = turingLoop(bits, 4, 2);
    expect(loop[2]).toBe(turingValue(bits));
    // One clock later (no flips) the register has rotated by one.
    const next = [bits[3], bits[0], bits[1], bits[2], ...bits.slice(4)];
    expect(loop[3]).toBe(turingValue(next));
    expect(loop).toHaveLength(4);
  });
});

describe('patch management', () => {
  it('renames and deletes saved patches', async () => {
    const store = new AppStore();
    await store.init();
    const first = store.patch.id;
    store.newPatch();
    await new Promise((r) => setTimeout(r, 20));
    const second = store.patch.id;
    await store.renamePatch(first, 'Ambient sketch');
    let list = await store.storage.list();
    expect(list.find((s) => s.id === first)?.name).toBe('Ambient sketch');
    await store.renamePatch(second, 'Current one');
    expect(store.patch.name).toBe('Current one');
    await store.deletePatch(second);
    list = await store.storage.list();
    expect(list.some((s) => s.id === second)).toBe(false);
    expect(store.patch.id).toBe(first);
  });
});
