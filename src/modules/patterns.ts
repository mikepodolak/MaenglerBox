import { defaultParams } from '../patch/model';
import type { ModuleDef, Preset } from '../patch/types';
import { MAX_STEPS, sequencerData, type SequencerData, type Step } from './sequencer';

/**
 * Starter patterns for the sequencers, so a new one has somewhere musical to
 * begin: broken IDM beats, skittering ratchets, acid bass, drifting minor
 * melodies and polymeters. Steps are written as strings, one character a step:
 *
 * - kit patterns name a sound per step, sent as an FM Drum preset number
 *   (k sub kick, K click kick, s snare, r rim, h closed hat, H open hat,
 *   m metal tick, b blip, t crushed tom, z shaker; - is a rest), so one
 *   sequencer into one FM Drum plays a whole kit;
 * - melodic patterns mark steps x (on), > (accent), . (ghost) or - (rest),
 *   and their notes are given in order for the steps that play.
 *
 * Extra strings give each step a chance (digit d = d × 10%, space or - = always)
 * and ratchets (2–4 hits).
 */

const KIT: Record<string, number> = { k: 1, K: 2, s: 3, r: 4, h: 5, H: 6, m: 7, b: 8, t: 9, z: 10 };

interface StepOpts {
  chance?: string;
  ratchet?: string;
  /** Gate lengths per step: digit d = (d + 1) × 10%. */
  gate?: string;
  cond?: Record<number, string>;
}

function rest(): Step {
  return { on: false, note: 48, velocity: 0.8, chance: 1, ratchet: 1, length: 0.5, send: 0, cond: '', plocks: {} };
}

function finish(steps: Step[], o: StepOpts): SequencerData {
  steps.forEach((s, i) => {
    const c = o.chance?.[i];
    if (c && /\d/.test(c)) s.chance = Number(c) / 10;
    const r = o.ratchet?.[i];
    if (r && /[2-4]/.test(r)) s.ratchet = Number(r);
    const g = o.gate?.[i];
    if (g && /\d/.test(g)) s.length = (Number(g) + 1) / 10;
    if (o.cond?.[i]) s.cond = o.cond[i];
  });
  while (steps.length < MAX_STEPS) steps.push(rest());
  return sequencerData.normalize({ steps });
}

function kit(sounds: string, o: StepOpts = {}): SequencerData {
  return finish(
    [...sounds].map((ch) => {
      const s = rest();
      const send = KIT[ch];
      if (send) Object.assign(s, { on: true, send, velocity: ch === 'k' || ch === 'K' ? 0.95 : 0.75 });
      return s;
    }),
    o,
  );
}

function melody(pattern: string, notes: number[], o: StepOpts = {}): SequencerData {
  let n = 0;
  return finish(
    [...pattern].map((ch) => {
      const s = rest();
      if (ch === '-') return s;
      s.on = true;
      s.note = notes[n++ % notes.length];
      s.velocity = ch === '>' ? 1 : ch === '.' ? 0.45 : 0.75;
      return s;
    }),
    o,
  );
}

type Sketch = [name: string, params: Record<string, number>, data: SequencerData];

/** C minor around C3 (48) and C4 (60); a Conductor or the Transpose setting moves them. */
const CHANCE_SEQUENCER: Sketch[] = [
  ['Kit: broken beat', {}, kit('k--h-sh-kkh-s-hm', { chance: '      7 4    6 5' })],
  ['Kit: skitter', {}, kit('K-hhs-hrK-hms-hh', { ratchet: '  2   3   2 4  3', chance: '  7  8   6 5  79' })],
  ['Kit: half-time', { length: 32 }, kit('k---h---s--th-H-k-h-k---s---h-mz', { chance: '    6      5      7 4     6  45' })],
  ['Kit: rolling toms', {}, kit('t-b-t-tbk-m-t-bm', { chance: '  6  5  4 6  5  ', ratchet: '     2     3    ' })],
  ['Acid bass', { scale: 1 }, melody('>-x.x->-x-.x>-xx', [36, 36, 48, 39, 36, 43, 34, 36, 46, 48], { gate: '9 3 3 9 4  3 7 4', ratchet: '         2     2' })],
  ['Minor drift', {}, melody('x--x--x-x--x-x--', [60, 63, 67, 70, 68, 63, 65, 62], { chance: '   8  7  6 8   ', gate: '7  6  9 5  6 8' })],
  ['Sparse bells', {}, melody('x----x---x-----x', [72, 79, 75, 84], { chance: '6    5   4     3', gate: '9    9   9     9' })],
  ['Arp of fifths', {}, melody('xxxxxxxxxxxxxxxx', [48, 55, 62, 67, 51, 58, 65, 70], { chance: '    8   7   6  ', gate: '2222222222222222' })],
  ['Polymeter 7', { length: 7 }, melody('>-x.-x-', [60, 67, 63, 58], { gate: '6 2 2 4' })],
  ['Polymeter 12', { length: 12 }, kit('k-hsk-h-m-hb', { chance: '  6   5 4 3 ' })],
  ['Evolving (conditions)', {}, melody('x-x-x-x-x-x-x-x-', [60, 62, 63, 67, 70, 72, 67, 63], { cond: { 2: '1:2', 6: '2:4', 10: '3:4', 12: 'fill', 14: '!pre' } })],
];

/** Tracker patterns: one track per sound, so each track goes to its own voice. */
function trackerPattern(tracks: SequencerData[]): { tracks: SequencerData[]; mutes: boolean[] } {
  const empty = () => melody('-', [48]);
  return { tracks: Array.from({ length: 8 }, (_, t) => tracks[t] ?? empty()), mutes: Array(8).fill(false) };
}

const one = (sound: string, kitPattern: string, o?: StepOpts) => kit(kitPattern.replace(/[^-]/g, sound), o);

const TRACKER: [string, Record<string, number>, ReturnType<typeof trackerPattern>][] = [
  [
    'IDM band',
    {},
    trackerPattern([
      one('k', 'k-----k---k--k--', { chance: '      7   6  5  ' }),
      one('s', '----s-------s--s', { chance: '               4', ratchet: '               3' }),
      one('h', 'hhhhhhhhhhhhhhhh', { chance: '8576857685768576', ratchet: '   2       3    ' }),
      one('m', '-m----m--m---m--', { chance: ' 5    6  4   5  ' }),
      melody('>-x.x->-x-.x>-xx', [36, 36, 48, 39, 36, 43, 34, 36], { gate: '9 3 3 9 4  3 7 4' }),
      melody('x----x---x-----x', [72, 79, 75, 84], { chance: '6    5   4     3' }),
    ]),
  ],
  [
    'Polyrhythms',
    {},
    trackerPattern([
      one('k', 'k--k--k--k--k--k'),
      one('s', '----s---s---s-s-', { chance: '        7   6 5 ' }),
      one('h', 'h-hh-hh-hh-hh-hh', { chance: '  7  6  5  7  6 ' }),
      one('b', 'b----b----b----b'),
      melody('x--x--x--x--x--x', [48, 51, 55, 58, 55, 51]),
    ]),
  ],
];

function complete(def: ModuleDef, sketches: [string, Record<string, number>, unknown][]): Preset[] {
  const base = defaultParams(def);
  return sketches.map(([name, params, data]) => ({ name, params: { ...base, ...params }, data: def.data ? def.data.normalize(data) : data }));
}

/** The starting pattern bank for a new Chance Sequencer or Tracker. */
export function starterPatterns(def: ModuleDef): (Preset | null)[] {
  const sketches = def.type === 'sequencer' ? CHANCE_SEQUENCER : def.type === 'tracker' ? TRACKER : [];
  return complete(def, sketches);
}
