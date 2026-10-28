import { addModule, connect, createPatch, type DefLookup } from './model';
import type { Patch } from './types';

/**
 * Starter patch: clock → chance sequencer → FM voice → output, so there's music on the first tap.
 * Laid out two by two so it fits a phone screen at a usable zoom.
 */
export function defaultPatch(defs: DefLookup): Patch {
  const def = (t: string) => {
    const d = defs(t);
    if (!d) throw new Error(`Missing module type ${t}`);
    return d;
  };
  let p = createPatch('First patch');
  let clock, seq, fm, out;
  [p, clock] = addModule(p, def('clock'), 40, 40);
  [p, seq] = addModule(p, def('sequencer'), 320, 40);
  [p, fm] = addModule(p, def('fm'), 40, 330);
  [p, out] = addModule(p, def('output'), 320, 330);
  [p] = connect(p, defs, { module: clock.id, port: 'out' }, { module: seq.id, port: 'clock' });
  [p] = connect(p, defs, { module: seq.id, port: 'out' }, { module: fm.id, port: 'gate' });
  [p] = connect(p, defs, { module: fm.id, port: 'out' }, { module: out.id, port: 'left' });
  [p] = connect(p, defs, { module: fm.id, port: 'out' }, { module: out.id, port: 'right' });
  return p;
}
