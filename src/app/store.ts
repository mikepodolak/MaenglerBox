import { getDef } from '../modules/registry';
import { createPatch, deserializePatch } from '../patch/model';
import { defaultPatch } from '../patch/defaultPatch';
import { setSlot } from '../patch/presets';
import type { Patch, Preset, PresetLibrary } from '../patch/types';
import { debounce, PatchStore } from '../storage/patchStore';
import { asCopy, exportPatch, mergeLibrary, parsePatchFile, type PatchFile } from '../patch/exchange';

export type SaveState = 'saved' | 'saving' | 'error';

/**
 * Per-device UI preferences, kept out of the patch.
 * - mode 'edit': move modules and patch cables; taps don't open settings.
 * - mode 'play': layout and cables are locked; tapping a module opens its settings.
 */
export interface Prefs {
  mode: 'edit' | 'play';
  cableStyle: 'curved' | 'square';
  /** How the sequencer's steps are shown: the 16-pad grid or the M8-style tracker. */
  stepView: 'grid' | 'tracker';
}

const PREFS_KEY = 'maenglerbox:prefs';
const DEFAULT_PREFS: Prefs = { mode: 'edit', cableStyle: 'curved', stepView: 'grid' };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      mode: raw.mode === 'play' ? 'play' : 'edit',
      cableStyle: raw.cableStyle === 'square' ? 'square' : 'curved',
      stepView: raw.stepView === 'tracker' ? 'tracker' : 'grid',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const HISTORY_LIMIT = 200;

/** Holds the open patch, notifies views on change, and autosaves to the device. */
export class AppStore {
  patch: Patch = createPatch();
  saveState: SaveState = 'saved';
  selected: string | null = null;
  prefs: Prefs = loadPrefs();
  /** Shared preset banks, the same in every patch. Not part of undo. */
  library: PresetLibrary = {};
  private undoStack: Patch[] = [];
  private redoStack: Patch[] = [];
  private lastCoalesce: string | undefined;
  private lastEditAt = 0;
  private listeners = new Set<() => void>();
  private readonly persist = debounce(() => void this.save(), 400);

  constructor(readonly storage = new PatchStore()) {}

  /** Reopen the last patch, or start from the default one. */
  async init(): Promise<void> {
    try {
      this.library = await this.storage.loadLibrary();
    } catch (e) {
      console.warn('Could not load the preset library', e);
    }
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

  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    if (this.prefs[key] === value) return;
    this.prefs = { ...this.prefs, [key]: value };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Not remembered across visits, but still applies now.
    }
    this.emit();
  }

  /** Put a preset in (or, with null, empty) a slot of a module type's shared bank. */
  setLibrarySlot(type: string, slot: number, preset: Preset | null): void {
    const bank = setSlot(this.library[type], slot, preset);
    this.library = { ...this.library, [type]: bank };
    this.emit();
    this.storage.saveBank(type, bank).catch((e) => {
      console.error('Saving the preset library failed', e);
      this.saveState = 'error';
      this.emit();
    });
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

  /** Rename any saved patch. The open one is renamed in place (undoably), others in storage. */
  async renamePatch(id: string, name: string): Promise<void> {
    const clean = name.trim() || 'Untitled';
    if (id === this.patch.id) {
      this.update((p) => ({ ...p, name: clean, updatedAt: Date.now() }));
      return;
    }
    const raw = await this.storage.load(id);
    if (!raw) return;
    const p = deserializePatch(raw, getDef);
    await this.storage.save({ ...p, name: clean }, false);
  }

  /** Delete a saved patch. Deleting the open one moves to the most recent other patch, or a fresh one. */
  async deletePatch(id: string): Promise<void> {
    await this.storage.remove(id);
    if (id !== this.patch.id) return;
    const next = (await this.storage.list())[0];
    if (next) await this.open(next.id);
    else this.newPatch();
  }

  /** The open patch as a file to share, with the presets its synths use. */
  exportFile(): PatchFile {
    return exportPatch(this.patch, this.library, getDef);
  }

  /**
   * Open a patch file from another device. `copy` keeps the device's own
   * version of the same patch and stores this one beside it. Its presets fill
   * empty library slots; returns how many were added and how many slots
   * already held something else.
   */
  async importFile(json: unknown, copy: boolean): Promise<{ added: number; skipped: number }> {
    const file = parsePatchFile(json, getDef);
    const merged = mergeLibrary(this.library, file.library);
    for (const type of merged.changed) await this.storage.saveBank(type, merged.library[type]);
    this.library = merged.library;
    this.replace(copy ? asCopy(file.patch) : file.patch);
    await this.save();
    return { added: merged.added, skipped: merged.skipped };
  }

  /** Whether this device already has a patch with this id. */
  async hasPatch(id: string): Promise<boolean> {
    return !!(await this.storage.load(id));
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
