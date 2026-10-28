import { getDef } from '../modules/registry';
import { createPatch, deserializePatch } from '../patch/model';
import { defaultPatch } from '../patch/defaultPatch';
import type { Patch } from '../patch/types';
import { debounce, PatchStore } from '../storage/patchStore';

export type SaveState = 'saved' | 'saving' | 'error';

/** Holds the open patch, notifies views on change, and autosaves to the device. */
export class AppStore {
  patch: Patch = createPatch();
  saveState: SaveState = 'saved';
  private listeners = new Set<() => void>();
  private readonly persist = debounce(() => void this.save(), 400);

  constructor(readonly storage = new PatchStore()) {}

  /** Reopen the last patch, or start from the default one. */
  async init(): Promise<void> {
    const lastId = this.storage.lastPatchId();
    if (lastId) {
      try {
        const raw = await this.storage.load(lastId);
        if (raw) {
          this.patch = deserializePatch(raw, getDef);
          this.emit();
          return;
        }
      } catch (e) {
        console.warn('Could not reopen last patch', e);
      }
    }
    this.patch = defaultPatch(getDef);
    this.emit();
    void this.save();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply an edit. All patch changes go through here so audio and storage stay in step. */
  update(fn: (p: Patch) => Patch): void {
    const next = fn(this.patch);
    if (next === this.patch) return;
    this.patch = next;
    this.emit();
    this.persist();
  }

  async open(id: string): Promise<void> {
    const raw = await this.storage.load(id);
    if (!raw) return;
    this.patch = deserializePatch(raw, getDef);
    this.emit();
    void this.save();
  }

  newPatch(): void {
    this.patch = defaultPatch(getDef);
    this.emit();
    void this.save();
  }

  private async save(): Promise<void> {
    this.saveState = 'saving';
    this.emit();
    try {
      await this.storage.save(this.patch);
      this.saveState = 'saved';
    } catch (e) {
      console.error('Save failed', e);
      this.saveState = 'error';
    }
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
