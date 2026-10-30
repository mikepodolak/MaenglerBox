import type { Recipe } from '../modules/help';
import { addModule, connect, PatchError, setParam, type DefLookup } from './model';
import type { ModuleDef, Patch } from './types';

/**
 * Add a help recipe to the patch: new modules laid out from `origin`, the
 * patch's existing clock and output reused where the recipe allows, and the
 * cables wired. Returns the patch and the recipe's own module (`self`).
 */
export function applyRecipe(
  patch: Patch,
  defs: DefLookup,
  recipe: Recipe,
  origin: { x: number; y: number },
  /** How tall a module's card is, so a tall one (a Matrix) doesn't land on the card below it. */
  height: (def: ModuleDef) => number = () => 0,
): { patch: Patch; selfId: string | null } {
  const ids: Record<string, string> = {};
  let p = patch;
  let slot = 0;
  let rowY = origin.y;
  let rowHeight = 0;
  for (const [key, spec] of Object.entries(recipe.modules)) {
    const existing = spec.reuse ? p.modules.find((m) => m.type === spec.type) : undefined;
    if (existing) {
      ids[key] = existing.id;
      continue;
    }
    const def = defs(spec.type);
    if (!def) throw new PatchError(`Unknown module type ${spec.type}`);
    // Two columns, so a recipe stays on screen on a phone.
    if (slot > 0 && slot % 2 === 0) {
      rowY += Math.max(300, rowHeight + 30);
      rowHeight = 0;
    }
    const x = origin.x + (slot % 2) * 240;
    const y = rowY;
    rowHeight = Math.max(rowHeight, height(def));
    slot++;
    let m;
    [p, m] = addModule(p, def, x, y);
    for (const [pid, v] of Object.entries(spec.params ?? {})) p = setParam(p, defs, m.id, pid, v);
    ids[key] = m.id;
  }
  for (const c of recipe.cables) {
    const [from, to] = c.split('>').map((s) => s.trim().split('.'));
    [p] = connect(p, defs, { module: ids[from[0]], port: from[1] }, { module: ids[to[0]], port: to[1] });
  }
  return { patch: p, selfId: ids.self ?? null };
}
