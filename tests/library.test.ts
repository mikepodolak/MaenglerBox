import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppStore } from '../src/app/store';
import { PatchRuntime } from '../src/engine/PatchRuntime';
import { getDef } from '../src/modules/registry';
import type { EngineEnv, ModuleType, RuntimeModule } from '../src/modules/types';
import { addModule, createPatch, setParam } from '../src/patch/model';
import { applyPreset, capturePreset, usesLibrary } from '../src/patch/presets';
import type { ModuleDef, Preset } from '../src/patch/types';
import { PatchStore } from '../src/storage/patchStore';

const def = (t: string) => getDef(t)!;

describe('preset library', () => {
  it('synth presets are shared; sequencer patterns stay in the patch', () => {
    expect(usesLibrary(def('fm'))).toBe(true);
    expect(usesLibrary(def('sequencer'))).toBe(false);
  });

  it('a preset captured in one patch loads into a module in another', () => {
    let a = createPatch();
    let fmA;
    [a, fmA] = addModule(a, def('fm'), 0, 0);
    a = setParam(a, getDef, fmA.id, 'feedback', 0.9);
    const preset = capturePreset(a.modules[0], 'Gong');

    let b = createPatch();
    let fmB;
    [b, fmB] = addModule(b, def('fm'), 0, 0);
    b = applyPreset(b, getDef, fmB.id, preset);
    expect(b.modules[0].params.feedback).toBe(0.9);
  });

  it('banks survive storage and junk is dropped', async () => {
    const store = new PatchStore();
    await store.saveBank('fm', [null, { name: 'Kick', params: { feedback: 0.2 } }]);
    await store.saveBank('junk', 'nope' as unknown as (Preset | null)[]);
    const lib = await store.loadLibrary();
    expect(lib.fm[1]?.name).toBe('Kick');
    expect(lib.junk).toBeUndefined();
  });

  it('the app store saves library slots and reloads them', async () => {
    const a = new AppStore(new PatchStore());
    await a.init();
    a.setLibrarySlot('fm', 3, { name: 'Snare', params: { feedback: 0.5 } });
    expect(a.library.fm).toHaveLength(16);
    await new Promise((r) => setTimeout(r, 20));
    const b = new AppStore(new PatchStore());
    await b.init();
    expect(b.library.fm[3]?.name).toBe('Snare');
    expect(b.patch.modules.find((m) => m.type === 'fm')?.presets).toBeUndefined();
  });

  it('the runtime gives library modules the shared bank and patch modules their own', () => {
    const got = new Map<string, unknown[]>();
    const fake = (type: string, presetScope?: 'library' | 'patch'): ModuleType => ({
      def: { type, label: type, inputs: [], outputs: [], params: [], presetScope } as ModuleDef,
      create: () =>
        ({
          inputs: {},
          outputs: {},
          setParam() {},
          setPresets: (p: unknown[]) => got.set(type, p),
          dispose() {},
        }) as unknown as RuntimeModule,
    });
    const types: Record<string, ModuleType> = { synth: fake('synth'), seq: fake('seq', 'patch') };
    const rt = new PatchRuntime({} as EngineEnv, (t) => types[t]);
    const own = [{ name: 'A1', params: {} }];
    const patch = {
      ...createPatch(),
      modules: [
        { id: 's', type: 'synth', x: 0, y: 0, params: {} },
        { id: 'q', type: 'seq', x: 0, y: 0, params: {}, presets: own },
      ],
    };
    const bank = [{ name: 'Kick', params: {} }];
    rt.setLibrary({ synth: bank, seq: [] });
    rt.sync(patch);
    expect(got.get('synth')).toBe(bank);
    expect(got.get('seq')).toBe(own);

    // A library change reaches running modules on the next sync.
    const bank2 = [...bank, { name: 'Snare', params: {} }];
    rt.setLibrary({ synth: bank2 });
    rt.sync(patch);
    expect(got.get('synth')).toBe(bank2);
  });
});
