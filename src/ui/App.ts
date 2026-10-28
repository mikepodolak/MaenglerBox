import type { AppStore } from '../app/store';
import type { AudioEngine, EngineState } from '../engine/AudioEngine';
import { allDefs, getDef } from '../modules/registry';
import { addModule, connect, disconnect, findModule, PatchError, removeModule, setParam } from '../patch/model';
import { formatParam, fromNormalized, toNormalized } from '../patch/params';
import type { ModuleInstance, Patch, PortRef } from '../patch/types';
import { h } from './dom';

const SLIDER_STEPS = 1000;

/**
 * Temporary list-style editor for step 1. It exercises the engine, model and
 * storage end to end; the patching canvas replaces it in step 2.
 */
export class App {
  private structureKey = '';
  private main = h('main', { class: 'modules' });
  private cablesEl = h('section', { class: 'cables' });
  private saveEl = h('span', { class: 'save-state' });
  private audioBtn = h('button', { class: 'audio-btn' });
  private nameInput = h('input', { class: 'patch-name', 'aria-label': 'Patch name' });
  private overlay = h('div', { class: 'start-overlay' });

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
    private readonly engine: AudioEngine,
  ) {}

  mount(): void {
    this.nameInput.addEventListener('change', () => {
      const name = this.nameInput.value.trim() || 'Untitled';
      this.store.update((p) => ({ ...p, name, updatedAt: Date.now() }));
    });
    this.audioBtn.addEventListener('click', () => {
      if (this.engine.state === 'running') void this.engine.suspend();
      else void this.engine.start();
    });

    this.overlay.append(
      h(
        'button',
        { class: 'start-btn', onclick: () => void this.engine.start() },
        h('strong', {}, 'Tap to start audio'),
        h('span', {}, 'Browsers need a tap before they make sound'),
      ),
    );

    const header = h(
      'header',
      { class: 'topbar' },
      h('span', { class: 'brand' }, 'MaenglerBox'),
      this.nameInput,
      this.saveEl,
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => void this.openMenu() }, 'Patches'),
      this.audioBtn,
    );

    this.root.replaceChildren(header, this.main, this.cablesEl, this.overlay);
    this.store.subscribe(() => this.render());
    this.engine.onState((s) => this.renderAudio(s));
    this.render();
  }

  private render(): void {
    const p = this.store.patch;
    this.engine.sync(p);
    if (document.activeElement !== this.nameInput) this.nameInput.value = p.name;
    this.saveEl.textContent =
      this.store.saveState === 'saving' ? 'Saving…' : this.store.saveState === 'error' ? 'Not saved' : 'Saved on this device';
    this.saveEl.dataset.state = this.store.saveState;

    // Rebuild the DOM only when modules or cables change, so sliders keep their touch while dragging.
    const key = p.id + '|' + p.modules.map((m) => m.id).join() + '|' + p.cables.map((c) => c.id).join();
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.main.replaceChildren(...p.modules.map((m) => this.moduleCard(m)), this.addModuleCard());
      this.renderCables(p);
    }
    this.updateParamReadouts(p);
  }

  private renderAudio(s: EngineState): void {
    this.audioBtn.textContent = s === 'running' ? 'Audio on' : s === 'starting' ? 'Starting…' : 'Audio off';
    this.audioBtn.dataset.state = s;
    this.overlay.hidden = s !== 'off';
  }

  private moduleCard(m: ModuleInstance): HTMLElement {
    const def = getDef(m.type)!;
    const params = def.params.map((p) => {
      const slider = h('input', {
        type: 'range',
        min: 0,
        max: SLIDER_STEPS,
        step: 1,
        'data-param': p.id,
        'aria-label': `${def.label} ${p.label}`,
      });
      slider.value = String(Math.round(toNormalized(p, m.params[p.id]) * SLIDER_STEPS));
      slider.addEventListener('input', () => {
        const v = fromNormalized(p, Number(slider.value) / SLIDER_STEPS);
        this.store.update((patch) => setParam(patch, getDef, m.id, p.id, v));
      });
      return h(
        'label',
        { class: 'param' },
        h('span', { class: 'param-label' }, p.label),
        slider,
        h('output', { 'data-readout': p.id }),
      );
    });
    const ports = (side: 'inputs' | 'outputs', arrow: string) =>
      def[side].length
        ? h('div', { class: `ports ${side}` }, arrow, ...def[side].map((pt) => h('span', { class: `port ${pt.kind}` }, pt.label)))
        : null;
    return h(
      'article',
      { class: 'module', 'data-module': m.id },
      h(
        'div',
        { class: 'module-head' },
        h('h2', {}, def.label),
        h('button', {
          class: 'icon',
          'aria-label': `Remove ${def.label}`,
          onclick: () => this.store.update((p) => removeModule(p, m.id)),
        }, '×'),
      ),
      ports('inputs', 'in'),
      ports('outputs', 'out'),
      ...params,
    );
  }

  private updateParamReadouts(p: Patch): void {
    for (const m of p.modules) {
      const card = this.main.querySelector<HTMLElement>(`[data-module="${m.id}"]`);
      const def = getDef(m.type);
      if (!card || !def) continue;
      for (const param of def.params) {
        const out = card.querySelector(`[data-readout="${param.id}"]`);
        if (out) out.textContent = formatParam(param, m.params[param.id]);
        const slider = card.querySelector<HTMLInputElement>(`[data-param="${param.id}"]`);
        if (slider && document.activeElement !== slider) {
          slider.value = String(Math.round(toNormalized(param, m.params[param.id]) * SLIDER_STEPS));
        }
      }
    }
  }

  private addModuleCard(): HTMLElement {
    const select = h('select', { 'aria-label': 'Module type' }, ...allDefs().map((d) => h('option', { value: d.type }, d.label)));
    return h(
      'article',
      { class: 'module add' },
      h('h2', {}, 'Add module'),
      select,
      h('button', {
        onclick: () => {
          const def = getDef(select.value);
          if (def) this.store.update((p) => addModule(p, def, 0, 0)[0]);
        },
      }, 'Add'),
    );
  }

  private renderCables(p: Patch): void {
    const name = (ref: PortRef, side: 'inputs' | 'outputs') => {
      const m = findModule(p, ref.module);
      const def = getDef(m.type)!;
      return `${def.label} ${def[side].find((x) => x.id === ref.port)?.label ?? ref.port}`;
    };
    const options = (side: 'inputs' | 'outputs') =>
      p.modules.flatMap((m) =>
        getDef(m.type)![side].map((pt) =>
          h('option', { value: JSON.stringify({ module: m.id, port: pt.id }) }, `${getDef(m.type)!.label} ${pt.label} (${pt.kind})`),
        ),
      );
    const fromSel = h('select', { 'aria-label': 'From output' }, ...options('outputs'));
    const toSel = h('select', { 'aria-label': 'To input' }, ...options('inputs'));
    const error = h('p', { class: 'error', role: 'status' });

    this.cablesEl.replaceChildren(
      h('h2', {}, 'Cables'),
      h(
        'ul',
        {},
        ...p.cables.map((c) =>
          h(
            'li',
            {},
            `${name(c.from, 'outputs')} → ${name(c.to, 'inputs')}`,
            h('button', { class: 'icon', 'aria-label': 'Remove cable', onclick: () => this.store.update((x) => disconnect(x, c.id)) }, '×'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'connect-row' },
        fromSel,
        h('span', {}, '→'),
        toSel,
        h('button', {
          onclick: () => {
            if (!fromSel.value || !toSel.value) return;
            try {
              this.store.update((x) => connect(x, getDef, JSON.parse(fromSel.value), JSON.parse(toSel.value))[0]);
            } catch (e) {
              error.textContent = e instanceof PatchError ? e.message : 'Could not connect';
            }
          },
        }, 'Connect'),
      ),
      error,
    );
  }

  private async openMenu(): Promise<void> {
    const list = await this.store.storage.list();
    const dialog = h('dialog', { class: 'patches' });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.append(
      h('h2', {}, 'Patches'),
      h(
        'ul',
        {},
        ...list.map((s) =>
          h(
            'li',
            {},
            h('button', {
              class: s.id === this.store.patch.id ? 'current' : undefined,
              onclick: () => {
                void this.store.open(s.id);
                close();
              },
            }, s.name),
            h('time', {}, new Date(s.updatedAt).toLocaleString()),
          ),
        ),
      ),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { onclick: () => { this.store.newPatch(); close(); } }, 'New patch'),
        h('button', { onclick: close }, 'Close'),
      ),
    );
    document.body.append(dialog);
    dialog.showModal();
  }
}
