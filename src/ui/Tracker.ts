import { CONDITIONS, conditionLabel, noteName, type SequencerData, type Step } from '../modules/sequencer';
import { h } from './dom';

type Col = 'note' | 'velocity' | 'chance' | 'ratchet' | 'cond' | 'send' | 'plocks';

interface ColDef {
  id: Col;
  head: string;
  name: string;
  show(s: Step): string;
  /** Change for a small (1) or big (2) nudge in direction `dir`; absent = not nudgeable. */
  nudge?(s: Step, dir: number, big: boolean): Partial<Step>;
}

const pct = (v: number) => String(Math.round(v * 99)).padStart(2, '0');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fine = (s: Step, key: 'velocity' | 'chance', dir: number, big: boolean, lo: number) => ({
  [key]: clamp(Math.round((s[key] + dir * (big ? 0.1 : 0.01)) * 100) / 100, lo, 1),
});

const COLS: ColDef[] = [
  {
    id: 'note',
    head: 'N',
    name: 'Note',
    show: (s) => (s.on ? noteName(s.note) : '---'),
    // Nudging an empty row's note switches it on, like typing a note into a tracker.
    nudge: (s, dir, big) => ({ on: true, note: s.on ? clamp(s.note + dir * (big ? 12 : 1), 0, 127) : s.note }),
  },
  { id: 'velocity', head: 'V', name: 'Velocity', show: (s) => pct(s.velocity), nudge: (s, d, b) => fine(s, 'velocity', d, b, 0) },
  { id: 'chance', head: '%', name: 'Chance', show: (s) => pct(s.chance), nudge: (s, d, b) => fine(s, 'chance', d, b, 0) },
  {
    id: 'ratchet',
    head: 'R',
    name: 'Ratchet',
    show: (s) => (s.ratchet > 1 ? `${s.ratchet}×` : '·'),
    nudge: (s, dir) => ({ ratchet: clamp(s.ratchet + dir, 1, 4) }),
  },
  {
    id: 'cond',
    head: 'CND',
    name: 'Condition',
    show: (s) => conditionLabel(s.cond) || '·',
    nudge: (s, dir, big) => {
      const i = CONDITIONS.findIndex((c) => c.id === s.cond);
      return { cond: CONDITIONS[clamp(i + dir * (big ? 4 : 1), 0, CONDITIONS.length - 1)].id };
    },
  },
  {
    id: 'send',
    head: 'P',
    name: 'Preset',
    show: (s) => (s.send ? String(s.send).padStart(2, '0') : '·'),
    nudge: (s, dir, big) => ({ send: clamp(s.send + dir * (big ? 4 : 1), 0, 16) }),
  },
  { id: 'plocks', head: 'L', name: 'Locks', show: (s) => (Object.keys(s.plocks).length ? String(Object.keys(s.plocks).length) : '·') },
];

/**
 * M8-style tracker: one row per step, one column per field. Tap a cell to put
 * the cursor on it, then nudge it with the bar below. Tapping the note cell
 * under the cursor switches the step on or off.
 */
export class Tracker {
  readonly el = h('div', { class: 'tracker' });
  private rows = h('div', { class: 'trk-rows', role: 'grid' });
  private cells: HTMLButtonElement[][] = [];
  private col: Col = 'note';
  private row = 0;
  private playing = -1;
  private data: SequencerData | null = null;
  private barLabel = h('output', { class: 'trk-value' });
  private nudgeBtns: HTMLButtonElement[] = [];
  private toggleBtn = h('button', { class: 'trk-toggle', onclick: () => this.toggle() }, 'On/Off');

  constructor(
    private readonly onSelect: (step: number) => void,
    private readonly onEdit: (step: number, change: Partial<Step>, coalesce: string) => void,
  ) {
    const head = h('div', { class: 'trk-row trk-head', role: 'row' }, h('span', { class: 'trk-num' }, '#'));
    for (const c of COLS) head.append(h('span', { class: `trk-cell col-${c.id}`, title: c.name }, c.head));
    const bar = h('div', { class: 'trk-bar' }, this.barLabel);
    for (const [label, dir, big] of [['−−', -1, true], ['−', -1, false], ['+', 1, false], ['++', 1, true]] as const) {
      const b = h('button', { 'aria-label': `${dir > 0 ? 'Up' : 'Down'}${big ? ' a lot' : ''}` }, label);
      b.addEventListener('click', () => this.nudge(dir, big));
      this.nudgeBtns.push(b);
      bar.append(b);
    }
    bar.append(this.toggleBtn);
    this.el.append(trackerHelp(), head, this.rows, bar);
  }

  update(data: SequencerData, len: number, selected: number): void {
    this.data = data;
    this.row = selected;
    while (this.cells.length < len) this.addRow(this.cells.length);
    while (this.cells.length > len) {
      this.cells.pop();
      this.rows.lastElementChild?.remove();
    }
    this.paint();
  }

  tick(step: number): void {
    if (step === this.playing) return;
    this.cells[this.playing]?.[0]?.parentElement?.classList.remove('playing');
    this.cells[step]?.[0]?.parentElement?.classList.add('playing');
    this.playing = step;
  }

  private addRow(i: number): void {
    const row = h('div', { class: 'trk-row', role: 'row' }, h('span', { class: 'trk-num' }, String(i + 1).padStart(2, '0')));
    const cells = COLS.map((c) => {
      const b = h('button', { class: `trk-cell col-${c.id}`, role: 'gridcell' });
      b.addEventListener('click', () => {
        if (this.row === i && this.col === c.id && c.id === 'note') this.toggle();
        this.col = c.id;
        this.row = i;
        this.onSelect(i);
        this.paint();
      });
      row.append(b);
      return b;
    });
    this.cells.push(cells);
    this.rows.append(row);
  }

  private paint(): void {
    if (!this.data) return;
    this.cells.forEach((cells, i) => {
      const s = this.data!.steps[i];
      cells[0].parentElement!.classList.toggle('off', !s.on);
      cells.forEach((b, j) => {
        const c = COLS[j];
        b.textContent = c.show(s);
        b.classList.toggle('cursor', i === this.row && c.id === this.col);
      });
    });
    const c = COLS.find((x) => x.id === this.col)!;
    const s = this.data.steps[this.row];
    this.barLabel.textContent = s
      ? `${String(this.row + 1).padStart(2, '0')} ${c.name}: ${c.id === 'cond' ? CONDITIONS.find((x) => x.id === s.cond)?.label : c.show(s)}`
      : 'Tap a cell to edit it';
    for (const b of this.nudgeBtns) b.disabled = !s || !c.nudge;
    this.toggleBtn.disabled = !s;
  }

  private nudge(dir: number, big: boolean): void {
    const c = COLS.find((x) => x.id === this.col);
    if (!c?.nudge || !this.data?.steps[this.row]) return;
    this.onEdit(this.row, c.nudge(this.data.steps[this.row], dir, big), `trk:${this.col}`);
  }

  private toggle(): void {
    if (!this.data?.steps[this.row]) return;
    this.onEdit(this.row, { on: !this.data.steps[this.row].on }, 'trk:on');
  }
}

/**
 * All of a multi-track Tracker's tracks side by side, one column per track,
 * like the M8's song view. Tap a cell to put the cursor on it (and edit that
 * step below); the bar nudges its note. Track headers mute and unmute.
 */
export class TrackOverview {
  readonly el = h('div', { class: 'tracker overview' });
  private rows = h('div', { class: 'trk-rows', role: 'grid' });
  private heads: HTMLButtonElement[] = [];
  private cells: HTMLButtonElement[][] = [];
  private track = 0;
  private step = 0;
  private playing = -1;
  private data: { tracks: SequencerData[]; mutes: boolean[] } | null = null;
  private barLabel = h('output', { class: 'trk-value' });
  private barBtns: HTMLButtonElement[] = [];

  constructor(
    private readonly trackCount: number,
    private readonly onSelect: (track: number, step: number) => void,
    private readonly onEdit: (track: number, step: number, change: Partial<Step>, coalesce: string) => void,
    private readonly onMute: (track: number) => void,
  ) {
    const head = h('div', { class: 'trk-row trk-head', role: 'row' }, h('span', { class: 'trk-num' }, '#'));
    for (let t = 0; t < trackCount; t++) {
      const b = h('button', { class: 'trk-cell trk-track', 'aria-pressed': 'false', title: `Track ${t + 1}: tap to mute` }, String(t + 1));
      b.addEventListener('click', () => this.onMute(t));
      this.heads.push(b);
      head.append(b);
    }
    head.style.setProperty('--tracks', String(trackCount));
    const bar = h('div', { class: 'trk-bar' }, this.barLabel);
    for (const [label, dir, big] of [['−−', -1, true], ['−', -1, false], ['+', 1, false], ['++', 1, true]] as const) {
      this.barBtns.push(h('button', { 'aria-label': `Note ${dir > 0 ? 'up' : 'down'}${big ? ' an octave' : ''}`, onclick: () => this.nudge(dir, big) }, label));
    }
    this.barBtns.push(h('button', { class: 'trk-toggle', onclick: () => this.toggle() }, 'On/Off'));
    bar.append(...this.barBtns);
    this.el.append(overviewHelp(), head, this.rows, bar);
  }

  update(data: { tracks: SequencerData[]; mutes: boolean[] }, len: number, track: number, step: number): void {
    this.data = data;
    this.track = track;
    this.step = step;
    while (this.cells.length < len) this.addRow(this.cells.length);
    while (this.cells.length > len) {
      this.cells.pop();
      this.rows.lastElementChild?.remove();
    }
    this.paint();
  }

  tick(step: number): void {
    if (step === this.playing) return;
    this.cells[this.playing]?.[0]?.parentElement?.classList.remove('playing');
    this.cells[step]?.[0]?.parentElement?.classList.add('playing');
    this.playing = step;
  }

  private addRow(i: number): void {
    const row = h('div', { class: 'trk-row', role: 'row' }, h('span', { class: 'trk-num' }, String(i + 1).padStart(2, '0')));
    row.style.setProperty('--tracks', String(this.trackCount));
    const cells: HTMLButtonElement[] = [];
    for (let t = 0; t < this.trackCount; t++) {
      const b = h('button', { class: 'trk-cell', role: 'gridcell' });
      b.addEventListener('click', () => {
        if (this.track === t && this.step === i) this.toggle();
        this.track = t;
        this.step = i;
        this.onSelect(t, i);
        this.paint();
      });
      cells.push(b);
      row.append(b);
    }
    this.cells.push(cells);
    this.rows.append(row);
  }

  private paint(): void {
    const d = this.data;
    if (!d) return;
    this.heads.forEach((b, t) => {
      b.setAttribute('aria-pressed', String(d.mutes[t]));
      b.classList.toggle('muted', d.mutes[t]);
      b.classList.toggle('current', t === this.track);
    });
    this.cells.forEach((cells, i) =>
      cells.forEach((b, t) => {
        const s = d.tracks[t].steps[i];
        b.textContent = s.on ? noteName(s.note) : '---';
        b.classList.toggle('off', !s.on);
        b.classList.toggle('muted', d.mutes[t]);
        b.classList.toggle('has-cond', s.on && !!s.cond);
        b.classList.toggle('has-locks', s.on && Object.keys(s.plocks).length > 0);
        b.classList.toggle('cursor', i === this.step && t === this.track);
      }),
    );
    const s = d.tracks[this.track].steps[this.step];
    this.barLabel.textContent =
      this.step >= 0 && s ? `T${this.track + 1} ${String(this.step + 1).padStart(2, '0')} ${s.on ? noteName(s.note) : '---'}` : 'Tap a cell to edit it';
    for (const b of this.barBtns) b.disabled = this.step < 0;
  }

  private nudge(dir: number, big: boolean): void {
    if (this.step < 0) return;
    const s = this.data?.tracks[this.track].steps[this.step];
    if (!s) return;
    const note = s.on ? clamp(s.note + dir * (big ? 12 : 1), 0, 127) : s.note;
    this.onEdit(this.track, this.step, { on: true, note }, 'ovw:note');
  }

  private toggle(): void {
    if (this.step < 0) return;
    const s = this.data?.tracks[this.track].steps[this.step];
    if (s) this.onEdit(this.track, this.step, { on: !s.on }, 'ovw:on');
  }
}

/** A collapsed "how to read this" note above the tracker. */
function trackerHelp(): HTMLElement {
  return h(
    'details',
    { class: 'trk-help' },
    h('summary', {}, 'What the columns mean'),
    h(
      'dl',
      {},
      ...COLS.flatMap((c) => [h('dt', {}, c.head), h('dd', {}, COL_HELP[c.id])]),
    ),
    h('p', {}, 'Tap a cell to put the cursor on it, then use −− − + ++ below to change it. Tap the note cell under the cursor to switch the step on or off.'),
  );
}

const COL_HELP: Record<Col, string> = {
  note: 'Note. --- means the step is off; nudging it switches it on.',
  velocity: 'Velocity, 00–99. How hard the note hits.',
  chance: 'Chance, 00–99. How likely the step is to play each time round.',
  ratchet: 'Ratchet: 2×–4× plays the note that many times within the step.',
  cond: 'Condition: which loops the step plays on, e.g. 1:2 = first of every two loops, PRE = only if the step before played.',
  send: 'Preset number sent with the note; the synth plays it with that preset.',
  plocks: 'How many of the synth\'s settings this step locks (set in the step editor below).',
};

function overviewHelp(): HTMLElement {
  return h(
    'details',
    { class: 'trk-help' },
    h('summary', {}, 'How this view works'),
    h('p', {}, 'Each column is a track and each row a step; cells show the note, or --- when the step is off. Tap a cell to edit that step below, and use −− − + ++ to change its note. Tap a track number at the top to mute or unmute it.'),
    h('p', {}, 'A yellow dot means the step has a condition; a teal dot means it has parameter locks.'),
  );
}
