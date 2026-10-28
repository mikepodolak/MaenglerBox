import type { AppStore } from '../app/store';
import { getDef } from '../modules/registry';
import { noteName, type SequencerData, type Step } from '../modules/sequencer';
import { removeModule, setModuleData, setParam } from '../patch/model';
import type { ModuleInstance, ParamDef } from '../patch/types';
import { paramControl, type ParamControl } from './controls';
import { h } from './dom';

/**
 * Panel for the selected module: every param, grouped, plus custom editors
 * like the sequencer's steps. Side panel on wide screens, bottom sheet on phones.
 */
export class Inspector {
  readonly el = h('aside', { class: 'inspector', 'aria-label': 'Module settings' });
  private moduleId: string | null = null;
  private controls = new Map<string, ParamControl>();
  private steps: StepEditor | null = null;

  constructor(private readonly store: AppStore) {}

  render(): void {
    const id = this.store.selected;
    const m = id ? this.store.patch.modules.find((x) => x.id === id) : undefined;
    this.el.classList.toggle('open', !!m);
    if (!m) {
      this.moduleId = null;
      this.el.replaceChildren();
      return;
    }
    if (m.id !== this.moduleId) this.build(m);
    for (const [pid, c] of this.controls) c.set(m.params[pid]);
    this.steps?.update(m);
  }

  tick(state: (moduleId: string) => unknown): void {
    if (this.moduleId) this.steps?.tick(state(this.moduleId));
  }

  private build(m: ModuleInstance): void {
    this.moduleId = m.id;
    this.controls.clear();
    const def = getDef(m.type)!;
    const control = (p: ParamDef) => {
      const c = paramControl(p, m.params[p.id], (v) =>
        this.store.update((x) => setParam(x, getDef, m.id, p.id, v), `param:${m.id}:${p.id}`),
      );
      this.controls.set(p.id, c);
      return c.el;
    };
    const byId = new Map(def.params.map((p) => [p.id, p]));
    const grouped = new Set((def.groups ?? []).flatMap((g) => g.params));
    const rest = def.params.filter((p) => !grouped.has(p.id));
    const groups = [
      ...(def.groups ?? []).map((g) => ({ label: g.label, params: g.params.map((id) => byId.get(id)!).filter(Boolean) })),
      ...(rest.length ? [{ label: def.groups ? 'More' : '', params: rest }] : []),
    ];

    this.steps = m.type === 'sequencer' ? new StepEditor(this.store, m.id) : null;

    const parts: (Node | null)[] = [
      h(
        'header',
        { class: 'inspector-head' },
        h('h2', {}, def.label),
        h('button', {
          class: 'danger',
          onclick: () => this.store.update((p) => removeModule(p, m.id)),
        }, 'Delete'),
        h('button', { class: 'icon', 'aria-label': 'Close', onclick: () => this.store.select(null) }, '×'),
      ),
      def.description ? h('p', { class: 'inspector-desc' }, def.description) : null,
      this.steps?.el ?? null,
      ...groups.map((g, i) =>
        h(
          'details',
          { class: 'param-group', open: i === 0 || groups.length <= 2 },
          h('summary', {}, g.label || 'Settings'),
          ...g.params.map(control),
        ),
      ),
    ];
    this.el.replaceChildren(...parts.filter((x): x is Node => x !== null));
    this.el.scrollTop = 0;
  }
}

const STEP_PARAMS: { key: keyof Step; label: string; def: ParamDef }[] = [
  { key: 'chance', label: 'Chance', def: { id: 'chance', label: 'Chance', min: 0, max: 1, default: 1, step: 0.01 } },
  { key: 'velocity', label: 'Velocity', def: { id: 'velocity', label: 'Velocity', min: 0, max: 1, default: 0.8, step: 0.01 } },
  { key: 'length', label: 'Length', def: { id: 'length', label: 'Length', min: 0.05, max: 1, default: 0.5, step: 0.01 } },
];

/**
 * Step grid. Tap a step to select it, tap it again to switch it on or off.
 * The selected step's details sit below the grid, tracker style.
 */
class StepEditor {
  readonly el = h('section', { class: 'steps' });
  private grid = h('div', { class: 'step-grid' });
  private detail = h('div', { class: 'step-detail' });
  private cells: HTMLButtonElement[] = [];
  private selected = 0;
  private lastPlaying = -1;
  private data: SequencerData | null = null;
  private len = 16;
  private noteLabel = h('output', { class: 'note-name' });
  private onBtn = h('button', { class: 'toggle' });
  private ratchetBtns: HTMLButtonElement[] = [];
  private stepControls = new Map<keyof Step, ParamControl>();
  private title = h('h3', {});

  constructor(
    private readonly store: AppStore,
    private readonly moduleId: string,
  ) {
    this.onBtn.addEventListener('click', () => this.edit({ on: !this.step().on }));
    const nudge = (d: number) => h('button', { onclick: () => this.edit({ note: this.step().note + d }) }, d > 0 ? `+${d}` : String(d));
    for (const r of [1, 2, 3, 4]) {
      this.ratchetBtns.push(h('button', { onclick: () => this.edit({ ratchet: r }) }, `${r}×`));
    }
    for (const sp of STEP_PARAMS) {
      this.stepControls.set(sp.key, paramControl(sp.def, 0, (v) => this.edit({ [sp.key]: v }, sp.key)));
    }
    this.detail.append(
      h('div', { class: 'step-detail-head' }, this.title, this.onBtn),
      h('div', { class: 'note-row' }, h('span', { class: 'param-label' }, 'Note'), nudge(-12), nudge(-1), this.noteLabel, nudge(1), nudge(12)),
      h('div', { class: 'ratchet-row' }, h('span', { class: 'param-label' }, 'Ratchet'), ...this.ratchetBtns),
      ...[...this.stepControls.values()].map((c) => c.el),
    );
    this.el.append(h('h3', { class: 'steps-title' }, 'Steps'), this.grid, this.detail);
  }

  update(m: ModuleInstance): void {
    this.data = m.data as SequencerData;
    this.len = Math.round(m.params.length);
    if (this.selected >= this.len) this.selected = 0;
    while (this.cells.length < this.len) {
      const i = this.cells.length;
      const cell = h('button', { class: 'step', 'aria-label': `Step ${i + 1}` });
      cell.addEventListener('click', () => {
        if (this.selected === i) this.edit({ on: !this.step().on });
        else {
          this.selected = i;
          this.paint();
        }
      });
      this.cells.push(cell);
      this.grid.append(cell);
    }
    while (this.cells.length > this.len) this.cells.pop()!.remove();
    this.paint();
  }

  tick(state: unknown): void {
    const step = (state as { step?: number } | undefined)?.step ?? -1;
    if (step === this.lastPlaying) return;
    this.cells[this.lastPlaying]?.classList.remove('playing');
    this.cells[step]?.classList.add('playing');
    this.lastPlaying = step;
  }

  private step(): Step {
    return this.data!.steps[this.selected];
  }

  private paint(): void {
    if (!this.data) return;
    this.cells.forEach((c, i) => {
      const s = this.data!.steps[i];
      c.classList.toggle('on', s.on);
      c.classList.toggle('selected', i === this.selected);
      c.style.setProperty('--chance', String(s.chance));
      c.textContent = s.on ? noteName(s.note) : '';
      if (s.ratchet > 1 && s.on) c.dataset.ratchet = `${s.ratchet}×`;
      else delete c.dataset.ratchet;
    });
    const s = this.step();
    this.title.textContent = `Step ${this.selected + 1}`;
    this.onBtn.textContent = s.on ? 'On' : 'Off';
    this.onBtn.classList.toggle('active', s.on);
    this.noteLabel.textContent = noteName(s.note);
    this.ratchetBtns.forEach((b, i) => b.classList.toggle('active', s.ratchet === i + 1));
    for (const [key, c] of this.stepControls) c.set(s[key] as number);
  }

  private edit(change: Partial<Step>, coalesceKey?: string): void {
    const data = this.data!;
    const i = this.selected;
    const steps = data.steps.map((s, j) => (j === i ? { ...s, ...change } : s));
    this.store.update(
      (p) => setModuleData(p, getDef, this.moduleId, { steps }),
      coalesceKey ? `step:${this.moduleId}:${i}:${coalesceKey}` : undefined,
    );
  }
}
