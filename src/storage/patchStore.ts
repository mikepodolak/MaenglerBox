import type { Patch } from '../patch/types';

const DB_NAME = 'maenglerbox';
const DB_VERSION = 1;
const PATCHES = 'patches';
const LAST_PATCH_KEY = 'maenglerbox:lastPatch';

export interface PatchSummary {
  id: string;
  name: string;
  updatedAt: number;
}

/** Patches live in IndexedDB on the device, so everything works offline. */
export class PatchStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly idb: IDBFactory = indexedDB) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = this.idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PATCHES)) db.createObjectStore(PATCHES, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PATCHES, mode);
      const req = fn(tx.objectStore(PATCHES));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async save(patch: Patch): Promise<void> {
    await this.run('readwrite', (s) => s.put(patch));
    rememberLast(patch.id);
  }

  async load(id: string): Promise<unknown | undefined> {
    return this.run('readonly', (s) => s.get(id));
  }

  async list(): Promise<PatchSummary[]> {
    const all = (await this.run('readonly', (s) => s.getAll())) as Patch[];
    return all
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async remove(id: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(id));
  }

  lastPatchId(): string | null {
    try {
      return localStorage.getItem(LAST_PATCH_KEY);
    } catch {
      return null;
    }
  }
}

function rememberLast(id: string): void {
  try {
    localStorage.setItem(LAST_PATCH_KEY, id);
  } catch {
    // Storage blocked (private mode): the patch is still saved, we just won't reopen it automatically.
  }
}

/**
 * Ask the browser not to evict our data. Safari clears site storage after
 * 7 days without a visit unless the app is installed to the home screen or
 * persistence is granted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Calls `fn` once things have been quiet for `ms`. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
