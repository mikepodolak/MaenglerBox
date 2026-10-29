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
    bar.append(h('button', { class: 'trk-toggle', onclick: () => this.toggle() }, 'On/Off'));
    this.el.append(head, this.rows, bar);
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
    this.barLabel.textContent = `${String(this.row + 1).padStart(2, '0')} ${c.name}: ${
      c.id === 'cond' ? CONDITIONS.find((x) => x.id === s.cond)?.label : c.show(s)
    }`;
    for (const b of this.nudgeBtns) b.disabled = !c.nudge;
  }

  private nudge(dir: number, big: boolean): void {
    const c = COLS.find((x) => x.id === this.col);
    if (!c?.nudge || !this.data) return;
    this.onEdit(this.row, c.nudge(this.data.steps[this.row], dir, big), `trk:${this.col}`);
  }

  private toggle(): void {
    if (!this.data) return;
    this.onEdit(this.row, { on: !this.data.steps[this.row].on }, 'trk:on');
  }
}
