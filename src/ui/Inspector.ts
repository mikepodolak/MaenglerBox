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
import { disconnect, exposeParam, hideParam, modPort, removeModule, setCableAmount, setModuleData, setParam } from '../patch/model';
import {
  applyPreset,
  capturePreset,
  clearPreset,
  MORPH,
  PRESET_SLOTS,
  randomizeParams,
  savePreset,
  setLocked,
  setMorph,
  usesLibrary,
} from '../patch/presets';
import { fullParamLabel } from '../patch/params';
import type { ModuleDef, ModuleInstance, ParamDef, Patch, Preset } from '../patch/types';
import { modTargetAttr } from './Canvas';
import { paramControl, type ParamControl } from './controls';
import { h } from './dom';
import { createEditor, type DataEditor } from './editors';
import { openHelp } from './help';
import { TrackOverview, Tracker } from './Tracker';
import { TRACKS, trackPort, type MultiTrackerData } from '../modules/multiTracker';

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
  private editor: DataEditor | null = null;
  private mods: ModPanel | null = null;

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
    this.editor?.update(m);
    this.mods?.update(m);
  }

  tick(state: (moduleId: string) => unknown, mods?: (moduleId: string) => ReadonlyMap<string, number> | undefined): void {
    if (!this.moduleId) return;
    const s = state(this.moduleId);
    this.steps?.tick(s);
    this.editor?.tick?.(s);
    const live = mods?.(this.moduleId);
    for (const [pid, c] of this.controls) c.setMod(live?.get(pid) ?? null);
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
        // Padlocks only matter where there's a Randomize button (which leaves Morph alone).
        def.presets && p.id !== MORPH
          ? () => {
              const locked = !(this.current()?.locks ?? []).includes(p.id);
              this.store.update((x) => setLocked(x, m.id, p.id, locked));
            }
          : undefined,
      );
      c.el.dataset.modTarget = modTargetAttr(m.id, p.id);
      this.controls.set(p.id, c);
      return c.el;
    };
    const byId = new Map(def.params.map((p) => [p.id, p]));
    // Morph lives with the presets it blends, not among the settings.
    const grouped = new Set([...(def.groups ?? []).flatMap((g) => g.params), MORPH]);
    const rest = def.params.filter((p) => !grouped.has(p.id));
    const groups = [
      ...(def.groups ?? []).map((g) => ({ label: g.label, params: g.params.map((id) => byId.get(id)!).filter(Boolean) })),
      ...(rest.length ? [{ label: def.groups ? 'More' : '', params: rest }] : []),
    ];

    const stepped = m.type === 'sequencer' || m.type === 'tracker';
    this.steps = stepped ? new StepEditor(this.store, m.id, m.type === 'tracker') : null;
    this.editor = createEditor(this.store, m);
    this.mods = new ModPanel(this.store, m.id);
    this.presets = def.presets ? new PresetPanel(this.store, m.id, stepped ? 'Patterns' : 'Presets', usesLibrary(def)) : null;
    const morph = byId.get(MORPH);
    if (morph) this.presets?.addMorph(control(morph));
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
        h('button', { class: 'icon help-btn', 'aria-label': `About ${def.label}`, title: 'How to use it', onclick: () => openHelp(this.store, m.type) }, '?'),
        h('button', {
          class: 'danger',
          onclick: () => this.store.update((p) => removeModule(p, m.id)),
        }, 'Delete'),
        h('button', { class: 'icon', 'aria-label': 'Close', onclick: () => this.store.select(null) }, '×'),
      ),
      def.description ? h('p', { class: 'inspector-desc' }, def.description) : null,
      this.presets?.el ?? null,
      this.steps?.patternEl ?? null,
      this.steps?.el ?? null,
      this.editor?.el ?? null,
      h(
        'section',
        { class: 'section settings' },
        h('h3', {}, 'Settings'),
        def.presets ? randomizeBar : null,
        def.presets ? h('p', { class: 'hint' }, 'Tap a padlock to keep that setting when randomizing.') : null,
        ...groups.map((g, i) =>
          h(
            'details',
            { class: 'param-group', open: i === 0 || groups.length <= 2 },
            h('summary', {}, g.label || 'Settings'),
            ...g.params.map(control),
          ),
        ),
      ),
      this.mods.el,
    ];
    const nodes = parts.filter((x): x is Node => x !== null);
    // Each section a shade lighter than the one above, so the eye can track where one ends.
    nodes.filter((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('section'))
      .forEach((el, i) => el.style.setProperty('--shade', String(i)));
    this.el.replaceChildren(...nodes);
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
  /** Collapsed by default: slots are used now and then, and they take a lot of room. */
  readonly el = h('details', { class: 'presets section' });
  private count = h('span', { class: 'count' });
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
      h('summary', {}, h('h3', {}, title), this.count),
      h('div', { class: 'presets-head' }, h('span', { class: 'hint' }, 'Pick an action, then tap a slot.'), actions),
      grid,
    );
    if (shared) this.el.append(h('p', { class: 'hint' }, 'Shared by every patch on this device.'));
  }

  private morphFrom: HTMLSelectElement | null = null;
  private morphTo: HTMLSelectElement | null = null;
  private morphBody: HTMLElement | null = null;
  /** From, remembered while To is still Off. */
  private morphStart: number | null = null;

  /**
   * Blend between two presets with one slider (which a cable can move): From
   * is a slot or the module's own settings, To is a slot or Off.
   */
  addMorph(slider: HTMLElement): void {
    this.morphFrom = h('select', { 'aria-label': 'Morph from' });
    this.morphTo = h('select', { 'aria-label': 'Morph to' });
    const change = () => {
      const b = Number(this.morphTo!.value);
      const a = this.morphFrom!.value === 'own' ? null : Number(this.morphFrom!.value);
      this.morphStart = a;
      this.store.update((p) => setMorph(p, this.moduleId, b >= 0 ? { a, b } : null));
    };
    this.morphFrom.addEventListener('change', change);
    this.morphTo.addEventListener('change', change);
    this.morphBody = h('div', { class: 'morph-body' }, slider);
    this.el.append(
      h(
        'div',
        { class: 'morph' },
        h('h4', {}, 'Morph'),
        h('div', { class: 'morph-pick' }, h('label', {}, 'From ', this.morphFrom), h('label', {}, 'To ', this.morphTo)),
        this.morphBody,
        h('p', { class: 'hint' }, 'While morphing, the settings follow the slider from one preset to the other. Patch an LFO onto Morph to sweep it.'),
      ),
    );
  }

  private paintMorph(): void {
    const m = this.module;
    if (!m || !this.morphFrom || !this.morphTo) return;
    const bank = this.bank();
    const opts = (first: [string, string]) => [
      h('option', { value: first[0] }, first[1]),
      ...bank.flatMap((p, i) => (p ? [h('option', { value: String(i) }, `${i + 1}: ${p.name}`)] : [])),
    ];
    this.morphFrom.replaceChildren(...opts(['own', 'Current settings']));
    this.morphTo.replaceChildren(...opts(['-1', 'Off']));
    const a = m.morph ? m.morph.a : this.morphStart;
    this.morphFrom.value = a === null || !bank[a] ? 'own' : String(a);
    this.morphTo.value = m.morph ? String(m.morph.b) : '-1';
    this.morphBody?.classList.toggle('off', !m.morph);
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
    const used = this.bank().filter(Boolean).length;
    this.count.textContent = used ? `${used} saved` : 'empty';
    this.el.dataset.action = this.action;
    this.slots.forEach((b, i) => {
      const p = this.bank()[i];
      b.classList.toggle('filled', !!p);
      b.replaceChildren(h('span', { class: 'slot-num' }, String(i + 1)), h('span', { class: 'slot-name' }, p?.name ?? ''));
      b.setAttribute('aria-label', `Slot ${i + 1}${p ? `: ${p.name}` : ', empty'}`);
    });
    this.paintMorph();
  }
}

const STEP_PARAMS: { key: keyof Step; label: string; def: ParamDef }[] = [
  { key: 'chance', label: 'Chance', def: { id: 'chance', label: 'Chance', min: 0, max: 1, default: 1, step: 0.01 } },
  { key: 'velocity', label: 'Velocity', def: { id: 'velocity', label: 'Velocity', min: 0, max: 1, default: 0.8, step: 0.01 } },
  { key: 'length', label: 'Length', def: { id: 'length', label: 'Length', min: 0.05, max: 1, default: 0.5, step: 0.01 } },
];

/**
 * Step grid. Tap a step to select it, tap it again to switch it on or off.
 * The selected step's details open below the grid; nothing is open until a
 * step is picked. Pattern-wide randomizing lives in `patternEl`, which the
 * inspector places above the steps.
 */
class StepEditor {
  readonly el = h('section', { class: 'steps section' });
  readonly patternEl = h('section', { class: 'pattern-tools section' });
  private grid = h('div', { class: 'step-grid' });
  private detail = h('div', { class: 'step-detail' });
  private cells: HTMLButtonElement[] = [];
  /** Selected step, or -1 for none. */
  private selected = -1;
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
  /** Multi-track Tracker only: the track being edited, its overview and track picker. */
  private track = 0;
  private overview: TrackOverview | null = null;
  private trackBtns: HTMLButtonElement[] = [];
  private trackPicker: HTMLElement | null = null;
  private module: ModuleInstance | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly moduleId: string,
    private readonly multi = false,
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
      (i) => this.select(i),
      (i, change, key) => this.edit(change, key, i),
    );
    this.detail.append(
      h(
        'div',
        { class: 'step-detail-head' },
        h('button', {
          class: 'icon dice',
          'aria-label': 'Randomize this step',
          title: 'Randomize this step',
          onclick: () => this.randomize(1, [this.selected]),
        }, '🎲'),
        this.title,
        h('span', { class: 'spacer' }),
        this.onBtn,
        h('button', { class: 'icon', 'aria-label': 'Close step', onclick: () => this.select(-1) }, '×'),
      ),
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
        this.write({ ...this.data!, locks: [...locks] });
      });
      this.fieldLockBtns.set(f, b);
      fieldLocks.append(b);
    }
    const patternBar = h(
      'div',
      { class: 'randomize-bar' },
      h('button', { onclick: () => this.randomize(1), title: 'New random steps, kept in the scale' }, 'Randomize'),
      h('button', { onclick: () => this.randomize(0.15), title: 'Nudge the steps a little' }, 'Mutate'),
    );
    this.patternEl.append(h('h3', {}, multi ? 'Randomize track' : 'Randomize pattern'), patternBar, fieldLocks);
    const views = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Step view' });
    for (const [v, label] of [['grid', 'Grid'], ['tracker', 'Tracker']] as const) {
      const b = h('button', { 'aria-pressed': 'false', onclick: () => this.store.setPref('stepView', v) }, label);
      this.viewBtns.set(v, b);
      views.append(b);
    }
    let trackPicker: HTMLElement | null = null;
    if (multi) {
      this.overview = new TrackOverview(
        TRACKS,
        (t, i) => {
          this.track = t;
          this.selected = i;
          if (this.module) this.update(this.module);
        },
        (t, i, change, key) => this.edit(change, key, i, t),
        (t) => {
          const d = this.module!.data as MultiTrackerData;
          const mutes = d.mutes.map((m, j) => (j === t ? !m : m));
          this.store.update((p) => setModuleData(p, getDef, this.moduleId, { ...d, mutes }));
        },
      );
      trackPicker = h('div', { class: 'segmented small track-picker', role: 'group', 'aria-label': 'Track' });
      this.trackPicker = trackPicker;
      for (let t = 0; t < TRACKS; t++) {
        const b = h('button', { 'aria-pressed': 'false', 'aria-label': `Track ${t + 1}` }, String(t + 1));
        b.addEventListener('click', () => {
          this.track = t;
          if (this.module) this.update(this.module);
        });
        this.trackBtns.push(b);
        trackPicker.append(b);
      }
    }
    this.el.append(
      h('div', { class: 'steps-head' }, h('h3', { class: 'steps-title' }, multi ? 'Tracks' : 'Steps'), views),
      trackPicker ?? '',
      this.grid,
      this.overview?.el ?? this.tracker.el,
      this.detail,
    );
  }

  update(m: ModuleInstance): void {
    this.module = m;
    this.data = this.multi ? (m.data as MultiTrackerData).tracks[this.track] : (m.data as SequencerData);
    this.settings = m.params;
    this.target = lockTarget(this.store.patch, m.id, this.multi ? trackPort(this.track) : 'out');
    this.len = Math.round(m.params.length);
    if (this.selected >= this.len) this.selected = -1;
    while (this.cells.length < this.len) {
      const i = this.cells.length;
      const cell = h('button', { class: 'step', 'aria-label': `Step ${i + 1}` });
      cell.addEventListener('click', () => {
        if (this.selected === i) this.edit({ on: !this.step().on });
        else this.select(i);
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
    this.overview?.tick(step);
  }

  private step(): Step {
    return this.data!.steps[Math.max(0, this.selected)];
  }

  private select(i: number): void {
    this.selected = i;
    this.paint();
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
    const locks = new Set(this.data.locks ?? []);
    for (const [f, b] of this.fieldLockBtns) b.setAttribute('aria-pressed', String(locks.has(f)));
    this.paintView();
    this.detail.hidden = this.selected < 0;
    if (this.selected < 0) return;

    const s = this.step();
    this.title.textContent = this.multi ? `Track ${this.track + 1} · Step ${this.selected + 1}` : `Step ${this.selected + 1}`;
    this.onBtn.textContent = s.on ? 'On' : 'Off';
    this.onBtn.classList.toggle('active', s.on);
    this.noteLabel.textContent = noteName(s.note);
    this.ratchetBtns.forEach((b, i) => b.classList.toggle('active', s.ratchet === i + 1));
    for (const [key, c] of this.stepControls) c.set(s[key] as number);
    this.sendLabel.textContent = s.send ? `P${s.send}` : '—';
    if (document.activeElement !== this.condSelect) this.condSelect.value = s.cond;
    this.paintLocks(s);
  }

  private paintView(): void {
    const view = this.store.prefs.stepView;
    for (const [v, b] of this.viewBtns) b.setAttribute('aria-pressed', String(v === view));
    this.grid.hidden = view !== 'grid';
    if (this.overview) {
      this.overview.el.hidden = view !== 'tracker';
      // The overview has its own track headers (tap to mute); the picker is for the grid.
      this.trackPicker!.hidden = view === 'tracker';
      if (view === 'tracker') this.overview.update(this.module!.data as MultiTrackerData, this.len, this.track, this.selected);
      this.trackBtns.forEach((b, t) => b.setAttribute('aria-pressed', String(t === this.track)));
    } else {
      this.tracker.el.hidden = view !== 'tracker';
      if (view === 'tracker') this.tracker.update(this.data!, this.len, this.selected);
    }
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
      h('option', { value: '' }, t
        ? (ids.length >= MAX_PLOCKS ? 'Lock limit reached' : '+ Lock a setting…')
        : `Patch ${this.multi ? `Track ${this.track + 1}` : 'Notes'} to a synth to lock its settings`),
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
    this.write(next);
  }

  private edit(change: Partial<Step>, coalesceKey?: string, i = this.selected, track = this.track): void {
    const data = this.trackData(track);
    const steps = data.steps.map((s, j) => (j === i ? { ...s, ...change } : s));
    this.write({ ...data, steps }, coalesceKey ? `step:${this.moduleId}:${track}:${i}:${coalesceKey}` : undefined, track);
  }

  private trackData(track: number): SequencerData {
    return this.multi ? (this.module!.data as MultiTrackerData).tracks[track] : this.data!;
  }

  /** Store one track's pattern: the whole data for a sequencer, one slot of `tracks` for a Tracker. */
  private write(next: SequencerData, coalesce?: string, track = this.track): void {
    this.store.update((p) => {
      if (!this.multi) return setModuleData(p, getDef, this.moduleId, next);
      const m = p.modules.find((x) => x.id === this.moduleId)!;
      const d = m.data as MultiTrackerData;
      return setModuleData(p, getDef, this.moduleId, { ...d, tracks: d.tracks.map((t, j) => (j === track ? next : t)) });
    }, coalesce);
  }
}

interface LockTarget {
  module: ModuleInstance;
  /** Lockable settings, labelled with their group so 'Ratio' reads 'Op2 Ratio'. */
  params: Map<string, { def: ParamDef; label: string }>;
}

/** The first synth patched to a sequencer's (or a track's) Notes output, whose settings its steps can lock. */
function lockTarget(patch: Patch, seqId: string, port: string): LockTarget | null {
  for (const c of patch.cables) {
    if (c.from.module !== seqId || c.from.port !== port) continue;
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

/**
 * The settings cables are moving: each one's jack, what's patched into it
 * and by how much, and a picker to give another setting a jack.
 */
class ModPanel {
  readonly el = h('section', { class: 'section mod-section' });
  private list = h('div', {});
  private picker = h('select', { 'aria-label': 'Add a jack for a setting' });
  private key = '';
  private amounts = new Map<string, ParamControl>();

  constructor(
    private readonly store: AppStore,
    private readonly moduleId: string,
  ) {
    this.picker.addEventListener('change', () => {
      const pid = this.picker.value;
      this.picker.value = '';
      if (pid) this.store.update((p) => exposeParam(p, getDef, this.moduleId, pid));
    });
    this.el.append(
      h('h3', {}, 'Modulation'),
      h('p', { class: 'hint' }, 'Drag any output onto a slider to move that setting with it, or give a setting its own jack here.'),
      this.list,
      h('div', { class: 'mod-add' }, this.picker),
    );
  }

  update(m: ModuleInstance): void {
    const def = getDef(m.type)!;
    const jacks = m.modJacks ?? [];
    const cables = this.store.patch.cables.filter((c) => c.to.module === m.id && c.to.port.startsWith('@'));
    const key = `${jacks.join(',')}|${cables.map((c) => `${c.id}:${c.from.module}.${c.from.port}`).join(',')}`;
    if (key !== this.key) {
      this.key = key;
      this.build(def, m, jacks, cables);
    }
    for (const c of cables) this.amounts.get(c.id)?.set(c.amount ?? 0);
  }

  private build(def: ModuleDef, m: ModuleInstance, jacks: string[], cables: Patch['cables']): void {
    this.amounts.clear();
    const label = (ref: { module: string; port: string }) => {
      const src = this.store.patch.modules.find((x) => x.id === ref.module);
      const sdef = src && getDef(src.type);
      const port = sdef?.outputs.find((o) => o.id === ref.port)?.label ?? ref.port;
      return `${sdef?.label ?? '?'} ${port}`;
    };
    this.list.replaceChildren(
      ...jacks.flatMap((pid) => {
        const p = def.params.find((x) => x.id === pid);
        if (!p) return [];
        const into = cables.filter((c) => c.to.port === modPort(pid));
        return [
          h(
            'div',
            { class: 'mod-row' },
            h(
              'div',
              { class: 'mod-row-head' },
              h('span', {}, `~ ${fullParamLabel(def, pid)}`),
              h('button', {
                class: 'small',
                title: 'Remove this jack and unplug its cables',
                onclick: () => this.store.update((x) => hideParam(x, m.id, pid)),
              }, 'Remove jack'),
            ),
            into.length
              ? null
              : h('p', { class: 'hint' }, `Patch an output into the ~ ${fullParamLabel(def, pid)} jack on the card.`),
            ...into.map((c) => {
              const amount = paramControl(
                { id: 'amount', label: 'Amount', min: -1, max: 1, default: 0.3, step: 0.01 },
                c.amount ?? 0,
                (v) => this.store.update((x) => setCableAmount(x, c.id, v), `amount:${c.id}`),
              );
              this.amounts.set(c.id, amount);
              return h(
                'div',
                { class: 'mod-cable' },
                h('span', {}, `from ${label(c.from)}`),
                h('button', { class: 'icon', 'aria-label': 'Unplug', title: 'Unplug', onclick: () => this.store.update((x) => disconnect(x, c.id)) }, '×'),
                amount.el,
              );
            }),
          ),
        ];
      }),
    );
    const free = def.params.filter((p) => !jacks.includes(p.id));
    const option = (p: ParamDef) => h('option', { value: p.id }, p.label);
    const grouped = new Set((def.groups ?? []).flatMap((g) => g.params));
    this.picker.replaceChildren(
      h('option', { value: '' }, free.length ? '+ Add a jack for a setting…' : 'Every setting has a jack'),
      // Listed under the same groups as the settings, so 'Ratio' says which operator.
      ...(def.groups ?? []).flatMap((g) => {
        const ps = free.filter((p) => g.params.includes(p.id));
        return ps.length ? [h('optgroup', { label: g.label }, ...ps.map(option))] : [];
      }),
      ...free.filter((p) => !grouped.has(p.id)).map(option),
    );
    this.picker.disabled = !free.length;
  }
}
