import { addModule, connect, createPatch, setParam, type DefLookup } from './model';
import type { Patch } from './types';

/** Starter patch: a clock pinging an enveloped oscillator, so there's sound on first tap. */
export function defaultPatch(defs: DefLookup): Patch {
  const def = (t: string) => {
    const d = defs(t);
    if (!d) throw new Error(`Missing module type ${t}`);
    return d;
  };
  let p = createPatch('First patch');
  let clock, env, osc, amp, out;
  [p, clock] = addModule(p, def('clock'), 40, 40);
  [p, env] = addModule(p, def('envelope'), 260, 40);
  [p, osc] = addModule(p, def('oscillator'), 40, 260);
  [p, amp] = addModule(p, def('vca'), 260, 260);
  [p, out] = addModule(p, def('output'), 480, 260);
  p = setParam(p, defs, osc.id, 'freq', 440);
  p = setParam(p, defs, osc.id, 'wave', 1);
  [p] = connect(p, defs, { module: clock.id, port: 'out' }, { module: env.id, port: 'gate' });
  [p] = connect(p, defs, { module: env.id, port: 'out' }, { module: amp.id, port: 'cv' });
  [p] = connect(p, defs, { module: osc.id, port: 'out' }, { module: amp.id, port: 'in' });
  [p] = connect(p, defs, { module: amp.id, port: 'out' }, { module: out.id, port: 'left' });
  [p] = connect(p, defs, { module: amp.id, port: 'out' }, { module: out.id, port: 'right' });
  return p;
}
