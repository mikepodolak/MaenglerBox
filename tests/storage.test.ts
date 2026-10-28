import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getDef } from '../src/modules/registry';
import { defaultPatch } from '../src/patch/defaultPatch';
import { deserializePatch } from '../src/patch/model';
import { PatchStore } from '../src/storage/patchStore';

describe('PatchStore', () => {
  it('saves, lists, loads and removes patches', async () => {
    const store = new PatchStore();
    const a = { ...defaultPatch(getDef), name: 'A', updatedAt: 1 };
    const b = { ...defaultPatch(getDef), name: 'B', updatedAt: 2 };
    await store.save(a);
    await store.save(b);
    expect((await store.list()).map((s) => s.name)).toEqual(['B', 'A']);
    expect(deserializePatch(await store.load(a.id), getDef).modules).toEqual(a.modules);
    await store.remove(a.id);
    expect(await store.load(a.id)).toBeUndefined();
  });
});
