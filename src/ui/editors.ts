import type { AppStore } from '../app/store';
import { LIFE_COLS, LIFE_ROWS, randomCells, type LifeData } from '../modules/life';
import { MARKOV_LEVELS, MARKOV_MAX, randomMarkov, stateLabel, type MarkovData, type MarkovState } from '../modules/markov';
import { getDef } from '../modules/registry';
import { setModuleData } from '../patch/model';
import type { ModuleInstance } from '../patch/types';
import { h } from './dom';

/** A custom section in the inspector for a module's data, like the Markov grid. */
export interface DataEditor {
  el: HTMLElement;
  update(m: ModuleInstance): void;
  tick?(state: unknown): void;
}

export function createEditor(store: AppStore, m: ModuleInstance): DataEditor | null {
  if (m.type === 'markov') return new MarkovEditor(store, m.id);
  if (m.type === 'life') return new LifeEditor(store, m.id);
  return null;
}

function write(store: AppStore, id: string, data: unknown): void {
  store.update((p) => setModuleData(p, getDef, id, data));
}

/**
 * The transition grid. Row = the state the chain is on, column = where it may
 * go next; a brighter cell is a likelier move. Tap a row's label to edit that
 * state's note, repeats and mute.
 */
class MarkovEditor implements DataEditor {
  readonly el = h('section', { class: 'markov section' });
  private grid = h('div', { class: 'markov-grid' });
  private detail = h('div', { class: 'markov-detail' });
  private cells: HTMLButtonElement[][] = [];
  private rowBtns: HTMLButtonElement[] = [];
  private colHeads: HTMLElement[] = [];
  private data: MarkovData | null = null;
  private size = 8;
  private selected = 0;
  private live = -1;
  private title = h('strong', {});
  private repeatBtns: HTMLButtonElement[] = [];
  private muteBtn = h('button', { 'aria-pressed': 'false' }, 'Rest');

  constructor(
    private readonly store: AppStore,
    private readonly id: string,
  ) {
    this.grid.append(h('span', { class: 'corner' }, 'from → to'));
    for (let c = 0; c < MARKOV_MAX; c++) {
      const head = h('span', { class: 'col-head' }, String(c + 1));
      this.colHeads.push(head);
      this.grid.append(head);
    }
    for (let r = 0; r < MARKOV_MAX; r++) {
      const rowBtn = h('button', { class: 'row-head', onclick: () => this.select(r) });
      this.rowBtns.push(rowBtn);
      this.grid.append(rowBtn);
      this.cells.push(
        Array.from({ length: MARKOV_MAX }, (_, c) => {
          const b = h('button', { class: 'cell', 'aria-label': `From ${r + 1} to ${c + 1}`, onclick: () => this.cycle(r, c) });
          this.grid.append(b);
          return b;
        }),
      );
    }
    for (const n of [1, 2, 3, 4]) {
      this.repeatBtns.push(h('button', { onclick: () => this.editState({ repeat: n }) }, `${n}×`));
    }
    this.muteBtn.addEventListener('click', () => this.editState({ mute: !this.state().mute }));
    const nudge = (d: number, label: string) => h('button', { onclick: () => this.editState({ note: this.state().note + d }) }, label);
    this.detail.append(
      h('div', { class: 'markov-detail-head' }, this.title),
      h('div', { class: 'row' }, h('span', { class: 'param-label' }, 'Note'), nudge(-12, '−oct'), nudge(-1, '−1'), nudge(1, '+1'), nudge(12, '+oct')),
      h('div', { class: 'row' }, h('span', { class: 'param-label' }, 'Stay'), h('div', { class: 'segmented small' }, ...this.repeatBtns), this.muteBtn),
    );
    this.el.append(
      h('h3', {}, 'Transitions'),
      h('p', { class: 'hint' }, 'Each row is a note; its cells are where the melody can go next. Tap a cell to make that move likelier (it cycles off, low, mid, high). Tap a row number to edit its note.'),
      h(
        'div',
        { class: 'randomize-bar' },
        h('button', { onclick: () => this.setWeights(randomMarkov(this.size)) }, 'Randomize'),
        h('button', { onclick: () => this.setWeights(this.walk()) }, 'Walk'),
        h('button', { onclick: () => this.setWeights(this.blank()) }, 'Clear'),
      ),
      this.grid,
      this.detail,
    );
  }

  private state(): MarkovState {
    return this.data!.states[this.selected];
  }

  private blank(): number[][] {
    return Array.from({ length: MARKOV_MAX }, () => Array(MARKOV_MAX).fill(0));
  }

  /** Each state steps to the next, the last back to the first: a plain scale run to edit from. */
  private walk(): number[][] {
    const w = this.blank();
    for (let r = 0; r < this.size; r++) w[r][(r + 1) % this.size] = MARKOV_LEVELS[3];
    return w;
  }

  private setWeights(weights: number[][]): void {
    if (this.data) write(this.store, this.id, { ...this.data, weights });
  }

  private cycle(r: number, c: number): void {
    if (!this.data) return;
    const cur = this.data.weights[r][c];
    // Snap odd values (from presets or randomize) onto the next level up.
    const next = MARKOV_LEVELS.find((l) => l > cur) ?? 0;
    this.setWeights(this.data.weights.map((row, i) => (i === r ? row.map((v, j) => (j === c ? next : v)) : row)));
  }

  private editState(change: Partial<MarkovState>): void {
    if (!this.data) return;
    const s = { ...this.state(), ...change };
    s.note = Math.min(127, Math.max(0, s.note));
    write(this.store, this.id, { ...this.data, states: this.data.states.map((x, i) => (i === this.selected ? s : x)) });
  }

  private select(r: number): void {
    this.selected = r;
    this.paint();
  }

  update(m: ModuleInstance): void {
    this.data = m.data as MarkovData;
    this.size = Math.round(m.params.size);
    if (this.selected >= this.size) this.selected = 0;
    this.paint();
  }

  private paint(): void {
    const d = this.data;
    if (!d) return;
    const n = this.size;
    this.grid.style.setProperty('--n', String(n));
    const max = MARKOV_LEVELS[MARKOV_LEVELS.length - 1];
    this.colHeads.forEach((el, c) => (el.hidden = c >= n));
    this.rowBtns.forEach((b, r) => {
      b.hidden = r >= n;
      b.textContent = `${r + 1} ${d.states[r].mute ? '·' : stateLabel(d.states[r])}`;
      b.classList.toggle('selected', r === this.selected);
    });
    this.cells.forEach((row, r) =>
      row.forEach((b, c) => {
        b.hidden = r >= n || c >= n;
        const w = d.weights[r][c];
        b.style.setProperty('--w', String(Math.min(1, w / max)));
        b.classList.toggle('on', w > 0);
      }),
    );
    const s = this.state();
    this.title.textContent = `State ${this.selected + 1}: ${stateLabel(s)}`;
    this.repeatBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(s.repeat === i + 1)));
    this.muteBtn.setAttribute('aria-pressed', String(s.mute));
    this.live = -2;
  }

  tick(state: unknown): void {
    const now = (state as { state?: number } | undefined)?.state ?? -1;
    if (now === this.live) return;
    this.rowBtns[this.live]?.classList.remove('playing');
    this.rowBtns[now]?.classList.add('playing');
    this.live = now;
  }
}

/** The starting grid for Game of Life. Tap or drag to draw cells; Reset on the module brings it back. */
class LifeEditor implements DataEditor {
  readonly el = h('section', { class: 'life section' });
  private grid = h('div', { class: 'life-grid', role: 'grid', 'aria-label': 'Starting cells' });
  private cells: HTMLElement[] = [];
  private data: LifeData | null = null;
  /** Cells as drawn during a drag, written to the patch once on release. */
  private draft: number[] | null = null;
  private paintValue = 1;

  constructor(
    private readonly store: AppStore,
    private readonly id: string,
  ) {
    this.grid.style.setProperty('--cols', String(LIFE_COLS));
    for (let i = 0; i < LIFE_ROWS * LIFE_COLS; i++) {
      const c = h('span', { class: 'cell', 'data-i': i });
      this.cells.push(c);
      this.grid.append(c);
    }
    const cellAt = (e: PointerEvent): number | null => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const i = el?.dataset.i;
      return i !== undefined && el?.parentElement === this.grid ? Number(i) : null;
    };
    this.grid.addEventListener('pointerdown', (e) => {
      const i = cellAt(e);
      if (i === null || !this.data) return;
      e.preventDefault();
      this.grid.setPointerCapture(e.pointerId);
      this.draft = this.data.cells.slice();
      this.paintValue = this.draft[i] ? 0 : 1;
      this.paintCell(i);
    });
    this.grid.addEventListener('pointermove', (e) => {
      if (!this.draft) return;
      const i = cellAt(e);
      if (i !== null) this.paintCell(i);
    });
    const finish = () => {
      if (!this.draft) return;
      const cells = this.draft;
      this.draft = null;
      write(this.store, this.id, { cells });
    };
    this.grid.addEventListener('pointerup', finish);
    this.grid.addEventListener('pointercancel', finish);
    this.el.append(
      h('h3', {}, 'Starting cells'),
      h('p', { class: 'hint' }, 'Draw the first generation. Higher rows play higher notes. Editing restarts the grid from your drawing.'),
      h(
        'div',
        { class: 'randomize-bar' },
        h('button', { onclick: () => write(this.store, this.id, { cells: randomCells(0.25) }) }, 'Randomize'),
        h('button', { onclick: () => write(this.store, this.id, { cells: Array(LIFE_ROWS * LIFE_COLS).fill(0) }) }, 'Clear'),
      ),
      this.grid,
    );
  }

  private paintCell(i: number): void {
    if (!this.draft) return;
    this.draft[i] = this.paintValue;
    this.cells[i].classList.toggle('on', this.paintValue === 1);
  }

  update(m: ModuleInstance): void {
    this.data = m.data as LifeData;
    this.cells.forEach((c, i) => c.classList.toggle('on', this.data!.cells[i] === 1));
  }
}
