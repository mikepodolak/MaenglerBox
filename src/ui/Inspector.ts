import type { AppStore } from '../app/store';
import { getDef } from '../modules/registry';
import {
  CONDITIONS,
  MAX_PLOCKS,
  noteName,
  randomizeSteps,
  STEP_FIELDS,
  type SequencerData,
  type Step,
  type StepField,
} from '../modules/sequencer';
import { removeModule, setModuleData, setParam } from '../patch/model';
import {
  applyPreset,
  capturePreset,
  clearPreset,
  PRESET_SLOTS,
  randomizeParams,
  savePreset,
  setLocked,
  usesLibrary,
} from '../patch/presets';
import type { ModuleDef, ModuleInstance, ParamDef, Patch, Preset } from '../patch/types';
import { paramControl, type ParamControl } from './controls';
import { h } from './dom';
import { Tracker } from './Tracker';

/**
 * Panel for the selected module: every param, grouped, plus custom editors
 * like the sequencer's steps. Side panel on wide screens, bottom sheet on phones.
 */
export class Inspector {
  readonly el = h('aside', { class: 'inspector', 'aria-label': 'Module settings' });
  private moduleId: string | null = null;
  private controls = new Map<string, ParamControl>();
  private steps: StepEditor | null = null;
  private presets: PresetPanel | null = null;

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
    const locks = new Set(m.locks ?? []);
    for (const [pid, c] of this.controls) {
      c.set(m.params[pid]);
      c.setLocked(locks.has(pid));
    }
    this.presets?.update(m);
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
      const c = paramControl(
        p,
        m.params[p.id],
        (v) => this.store.update((x) => setParam(x, getDef, m.id, p.id, v), `param:${m.id}:${p.id}`),
        false,
        () => {
          const locked = !(this.current()?.locks ?? []).includes(p.id);
          this.store.update((x) => setLocked(x, m.id, p.id, locked));
        },
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
    this.presets = new PresetPanel(this.store, m.id, m.type === 'sequencer' ? 'Patterns' : 'Presets', usesLibrary(def));
    const mutateAmount = h('input', { type: 'range', min: 1, max: 50, step: 1, 'aria-label': 'Mutate amount' });
    mutateAmount.value = '15';
    const randomizeBar = h(
      'div',
      { class: 'randomize-bar' },
      h('button', {
        onclick: () => this.store.update((x) => randomizeParams(x, getDef, m.id, { amount: 1 })),
        title: 'Set every unlocked setting to a random value',
      }, 'Randomize'),
      h('button', {
        onclick: () => this.store.update((x) => randomizeParams(x, getDef, m.id, { amount: Number(mutateAmount.value) / 100 })),
        title: 'Nudge every unlocked setting a little',
      }, 'Mutate'),
      h('label', { class: 'mutate-amount' }, h('span', { class: 'param-label' }, 'Amount'), mutateAmount),
    );

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
      this.presets.el,
      this.steps?.el ?? null,
      h('section', { class: 'randomize' }, h('h3', {}, 'Settings'), randomizeBar,
        h('p', { class: 'hint' }, 'Tap a padlock to keep that setting when randomizing.')),
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

  private current(): ModuleInstance | undefined {
    return this.store.patch.modules.find((x) => x.id === this.moduleId);
  }
}

type SlotAction = 'load' | 'save' | 'clear';

/**
 * 16 numbered slots. Pick an action, then tap a slot. On a sequencer these are
 * its pattern bank, saved in the patch. On a synth they're its presets (which
 * step values can call up), shared by every patch through the library.
 */
class PresetPanel {
  readonly el = h('section', { class: 'presets' });
  private action: SlotAction = 'load';
  private slots: HTMLButtonElement[] = [];
  private actionBtns = new Map<SlotAction, HTMLButtonElement>();
  private module: ModuleInstance | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly moduleId: string,
    title: string,
    private readonly shared: boolean,
  ) {
    const actions = h('div', { class: 'segmented small', role: 'group', 'aria-label': `${title} action` });
    for (const [a, label] of [['load', 'Load'], ['save', 'Save'], ['clear', 'Clear']] as const) {
      const b = h('button', { 'aria-pressed': 'false' }, label);
      b.addEventListener('click', () => {
        this.action = a;
        this.paint();
      });
      this.actionBtns.set(a, b);
      actions.append(b);
    }
    const grid = h('div', { class: 'slot-grid' });
    for (let i = 0; i < PRESET_SLOTS; i++) {
      const b = h('button', { class: 'slot' });
      b.addEventListener('click', () => this.tap(i));
      this.slots.push(b);
      grid.append(b);
    }
    this.el.append(
      h('div', { class: 'presets-head' }, h('h3', {}, title), actions),
      grid,
    );
    if (shared) this.el.append(h('p', { class: 'hint' }, 'Shared by every patch on this device.'));
  }

  private bank(): readonly (Preset | null)[] {
    const m = this.module;
    if (!m) return [];
    return (this.shared ? this.store.library[m.type] : m.presets) ?? [];
  }

  update(m: ModuleInstance): void {
    this.module = m;
    this.paint();
  }

  private tap(slot: number): void {
    const m = this.module;
    if (!m) return;
    const filled = this.bank()[slot];
    if (this.action === 'load') {
      if (filled) this.store.update((p) => applyPreset(p, getDef, this.moduleId, filled));
    } else if (this.action === 'save') {
      const input = window.prompt('Name this slot', filled?.name ?? `${slot + 1}`);
      if (input === null) return;
      const name = input.trim() || `${slot + 1}`;
      if (this.shared) this.store.setLibrarySlot(m.type, slot, capturePreset(m, name));
      else this.store.update((p) => savePreset(p, this.moduleId, slot, name));
      this.action = 'load';
    } else if (filled) {
      if (this.shared) this.store.setLibrarySlot(m.type, slot, null);
      else this.store.update((p) => clearPreset(p, this.moduleId, slot));
    }
    this.paint();
  }

  private paint(): void {
    for (const [a, b] of this.actionBtns) b.setAttribute('aria-pressed', String(a === this.action));
    this.el.dataset.action = this.action;
    this.slots.forEach((b, i) => {
      const p = this.bank()[i];
      b.classList.toggle('filled', !!p);
      b.replaceChildren(h('span', { class: 'slot-num' }, String(i + 1)), h('span', { class: 'slot-name' }, p?.name ?? ''));
      b.setAttribute('aria-label', `Slot ${i + 1}${p ? `: ${p.name}` : ', empty'}`);
    });
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
  private sendLabel = h('output', { class: 'note-name' });
  private fieldLockBtns = new Map<StepField, HTMLButtonElement>();
  private settings: Record<string, number> = {};
  private tracker: Tracker;
  private viewBtns = new Map<'grid' | 'tracker', HTMLButtonElement>();
  private condSelect = h('select', { 'aria-label': 'Condition' });
  private lockList = h('div', { class: 'plock-list' });
  private lockAdd = h('select', { class: 'plock-add', 'aria-label': 'Lock a setting' });
  private target: LockTarget | null = null;
  private lockControls = new Map<string, ParamControl>();

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
    const send = (d: number) =>
      h('button', { onclick: () => this.edit({ send: Math.min(16, Math.max(0, this.step().send + d)) }) }, d > 0 ? '+' : '−');
    for (const c of CONDITIONS) this.condSelect.append(h('option', { value: c.id }, c.label));
    this.condSelect.addEventListener('change', () => this.edit({ cond: this.condSelect.value }));
    this.lockAdd.addEventListener('change', () => {
      const id = this.lockAdd.value;
      this.lockAdd.value = '';
      if (!id || !this.target) return;
      this.edit({ plocks: { ...this.step().plocks, [id]: this.target.module.params[id] } });
    });
    this.tracker = new Tracker(
      (i) => {
        this.selected = i;
        this.paint();
      },
      (i, change, key) => this.edit(change, key, i),
    );
    this.detail.append(
      h('div', { class: 'step-detail-head' }, this.title,
        h('button', { onclick: () => this.randomize(1, [this.selected]), title: 'Randomize this step' }, 'Randomize step'),
        this.onBtn),
      h('div', { class: 'note-row' }, h('span', { class: 'param-label' }, 'Note'), nudge(-12), nudge(-1), this.noteLabel, nudge(1), nudge(12)),
      h('div', { class: 'ratchet-row' }, h('span', { class: 'param-label' }, 'Ratchet'), ...this.ratchetBtns),
      ...[...this.stepControls.values()].map((c) => c.el),
      h('div', { class: 'send-row', title: 'A synth plays this step with the preset of this number' },
        h('span', { class: 'param-label' }, 'Preset'), send(-1), this.sendLabel, send(1)),
      h('label', { class: 'param choice', title: 'When this step is allowed to play' },
        h('span', { class: 'param-label' }, 'Condition'), this.condSelect),
      h('div', { class: 'plocks' }, h('h4', {}, 'Parameter locks'), this.lockList, this.lockAdd),
    );
    const fieldLocks = h('div', { class: 'field-locks' }, h('span', { class: 'param-label' }, 'Keep'));
    for (const f of STEP_FIELDS) {
      const b = h('button', { 'aria-pressed': 'false', title: `Keep ${f} when randomizing` }, f === 'send' ? 'preset' : f);
      b.addEventListener('click', () => {
        const locks = new Set(this.data!.locks ?? []);
        if (locks.has(f)) locks.delete(f);
        else locks.add(f);
        this.store.update((p) => setModuleData(p, getDef, this.moduleId, { ...this.data!, locks: [...locks] }));
      });
      this.fieldLockBtns.set(f, b);
      fieldLocks.append(b);
    }
    const patternBar = h(
      'div',
      { class: 'randomize-bar' },
      h('button', { onclick: () => this.randomize(1) }, 'Randomize pattern'),
      h('button', { onclick: () => this.randomize(0.15) }, 'Mutate pattern'),
    );
    const views = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Step view' });
    for (const [v, label] of [['grid', 'Grid'], ['tracker', 'Tracker']] as const) {
      const b = h('button', { 'aria-pressed': 'false', onclick: () => this.store.setPref('stepView', v) }, label);
      this.viewBtns.set(v, b);
      views.append(b);
    }
    this.el.append(
      h('div', { class: 'steps-head' }, h('h3', { class: 'steps-title' }, 'Steps'), views),
      this.grid,
      this.tracker.el,
      this.detail,
      patternBar,
      fieldLocks,
    );
  }

  update(m: ModuleInstance): void {
    this.data = m.data as SequencerData;
    this.settings = m.params;
    this.target = lockTarget(this.store.patch, m.id);
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
    this.tracker.tick(step);
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
    this.sendLabel.textContent = s.send ? `P${s.send}` : '—';
    const locks = new Set(this.data.locks ?? []);
    for (const [f, b] of this.fieldLockBtns) b.setAttribute('aria-pressed', String(locks.has(f)));
    if (document.activeElement !== this.condSelect) this.condSelect.value = s.cond;

    const view = this.store.prefs.stepView;
    for (const [v, b] of this.viewBtns) b.setAttribute('aria-pressed', String(v === view));
    this.grid.hidden = view !== 'grid';
    this.tracker.el.hidden = view !== 'tracker';
    if (view === 'tracker') this.tracker.update(this.data, this.len, this.selected);
    this.paintLocks(s);
  }

  /** One slider per locked setting, plus a picker for the settings of the synth this sequencer plays. */
  private paintLocks(s: Step): void {
    const t = this.target;
    const ids = Object.keys(s.plocks);
    const key = `${t?.module.id}|${this.selected}|${ids.join(',')}`;
    if (this.lockList.dataset.key !== key) {
      this.lockList.dataset.key = key;
      this.lockControls.clear();
      this.lockList.replaceChildren(
        ...ids.map((id) => {
          const p = t?.params.get(id);
          if (!p) {
            return h('div', { class: 'plock missing' }, h('span', {}, `${id} (not on the patched synth)`), this.removeLockBtn(id));
          }
          const c = paramControl(p.def, s.plocks[id], (v) => this.edit({ plocks: { ...this.step().plocks, [id]: v } }, `lock:${id}`));
          c.el.querySelector('.param-label')!.textContent = p.label;
          this.lockControls.set(id, c);
          return h('div', { class: 'plock' }, c.el, this.removeLockBtn(id));
        }),
      );
    } else {
      // Same rows: just move the sliders.
      for (const [id, c] of this.lockControls) c.set(s.plocks[id]);
    }
    const options: (HTMLOptionElement | null)[] = [
      h('option', { value: '' }, t ? (ids.length >= MAX_PLOCKS ? 'Lock limit reached' : '+ Lock a setting…') : 'Patch Notes to a synth to lock its settings'),
    ];
    if (t && ids.length < MAX_PLOCKS) {
      for (const [id, p] of t.params) if (!(id in s.plocks)) options.push(h('option', { value: id }, p.label));
    }
    this.lockAdd.replaceChildren(...options.filter((o): o is HTMLOptionElement => o !== null));
    this.lockAdd.disabled = !t || ids.length >= MAX_PLOCKS;
  }

  private removeLockBtn(id: string): HTMLButtonElement {
    return h('button', {
      class: 'icon',
      'aria-label': `Remove lock on ${id}`,
      onclick: () => {
        const { [id]: _, ...rest } = this.step().plocks;
        this.edit({ plocks: rest });
      },
    }, '×');
  }

  private randomize(amount: number, steps?: number[]): void {
    const next = randomizeSteps(this.data!, {
      amount,
      steps,
      length: Math.round(this.settings.length ?? 16),
      scale: this.settings.scale,
      root: this.settings.root,
    });
    this.store.update((p) => setModuleData(p, getDef, this.moduleId, next));
  }

  private edit(change: Partial<Step>, coalesceKey?: string, i = this.selected): void {
    const data = this.data!;
    const steps = data.steps.map((s, j) => (j === i ? { ...s, ...change } : s));
    this.store.update(
      (p) => setModuleData(p, getDef, this.moduleId, { ...data, steps }),
      coalesceKey ? `step:${this.moduleId}:${i}:${coalesceKey}` : undefined,
    );
  }
}

interface LockTarget {
  module: ModuleInstance;
  /** Lockable settings, labelled with their group so 'Ratio' reads 'Op2 Ratio'. */
  params: Map<string, { def: ParamDef; label: string }>;
}

/** The first synth patched to a sequencer's Notes output, whose settings its steps can lock. */
function lockTarget(patch: Patch, seqId: string): LockTarget | null {
  for (const c of patch.cables) {
    if (c.from.module !== seqId || c.from.port !== 'out') continue;
    const module = patch.modules.find((m) => m.id === c.to.module);
    const def = module && getDef(module.type);
    if (module && def && def.params.length) return { module, params: lockableParams(def) };
  }
  return null;
}

function lockableParams(def: ModuleDef): Map<string, { def: ParamDef; label: string }> {
  const groupOf = new Map<string, string>();
  for (const g of def.groups ?? []) for (const id of g.params) groupOf.set(id, g.label);
  const short = (g: string) => g.replace(/^Operator (\d+).*$/, 'Op$1');
  return new Map(
    def.params.map((p) => {
      const g = groupOf.get(p.id);
      return [p.id, { def: p, label: g && /^Operator/.test(g) ? `${short(g)} ${p.label}` : p.label }];
    }),
  );
}
