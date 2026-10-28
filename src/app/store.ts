import { getDef } from '../modules/registry';
import { createPatch, deserializePatch } from '../patch/model';
import { defaultPatch } from '../patch/defaultPatch';
import type { Patch } from '../patch/types';
import { debounce, PatchStore } from '../storage/patchStore';

export type SaveState = 'saved' | 'saving' | 'error';

const HISTORY_LIMIT = 200;

/** Holds the open patch, notifies views on change, and autosaves to the device. */
export class AppStore {
  patch: Patch = createPatch();
  saveState: SaveState = 'saved';
  selected: string | null = null;
  private undoStack: Patch[] = [];
  private redoStack: Patch[] = [];
  private lastCoalesce: string | undefined;
  private lastEditAt = 0;
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

  /**
   * Apply an edit. All patch changes go through here so audio, undo and storage stay in step.
   * Edits sharing a `coalesce` key in quick succession (a slider drag) undo as one step.
   */
  update(fn: (p: Patch) => Patch, coalesce?: string): void {
    const next = fn(this.patch);
    if (next === this.patch) return;
    const now = Date.now();
    if (!coalesce || coalesce !== this.lastCoalesce || now - this.lastEditAt > 1000) {
      this.undoStack.push(this.patch);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastCoalesce = coalesce;
    this.lastEditAt = now;
    this.setPatch(next);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.patch);
    this.lastCoalesce = undefined;
    this.setPatch(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.patch);
    this.lastCoalesce = undefined;
    this.setPatch(next);
  }

  /** UI selection lives here so every view agrees on it. It isn't saved or undone. */
  select(moduleId: string | null): void {
    if (this.selected === moduleId) return;
    this.selected = moduleId;
    this.emit();
  }

  private setPatch(next: Patch): void {
    this.patch = next;
    if (this.selected && !next.modules.some((m) => m.id === this.selected)) this.selected = null;
    this.emit();
    this.persist();
  }

  async open(id: string): Promise<void> {
    const raw = await this.storage.load(id);
    if (!raw) return;
    this.replace(deserializePatch(raw, getDef));
    void this.save();
  }

  newPatch(): void {
    this.replace(defaultPatch(getDef));
    void this.save();
  }

  /** Switch to a different patch, clearing undo history and selection. */
  private replace(patch: Patch): void {
    this.patch = patch;
    this.undoStack = [];
    this.redoStack = [];
    this.selected = null;
    this.emit();
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
