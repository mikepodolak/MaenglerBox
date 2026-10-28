import type { AppStore } from '../app/store';
import type { AudioEngine, EngineState } from '../engine/AudioEngine';
import { allDefs, getDef } from '../modules/registry';
import { addModule } from '../patch/model';
import { Canvas } from './Canvas';
import { h } from './dom';
import { Inspector } from './Inspector';

export class App {
  private canvas: Canvas;
  private inspector: Inspector;
  private saveEl = h('span', { class: 'save-state' });
  private audioBtn = h('button', { class: 'audio-btn' });
  private undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo', title: 'Undo' }, '↶');
  private redoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Redo', title: 'Redo' }, '↷');
  private nameInput = h('input', { class: 'patch-name', 'aria-label': 'Patch name' });
  private overlay = h('div', { class: 'start-overlay' });
  private modeBtns = {
    edit: h('button', { 'aria-pressed': 'false', title: 'Move modules and patch cables' }, 'Edit'),
    play: h('button', { 'aria-pressed': 'false', title: 'Layout locked; tap a module to open its settings' }, 'Play'),
  };
  private cableBtn = h('button', { class: 'icon-btn', title: 'Cable style' });

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
    private readonly engine: AudioEngine,
  ) {
    this.canvas = new Canvas(store);
    this.inspector = new Inspector(store);
  }

  mount(): void {
    this.nameInput.addEventListener('change', () => {
      const name = this.nameInput.value.trim() || 'Untitled';
      this.store.update((p) => ({ ...p, name, updatedAt: Date.now() }));
    });
    this.audioBtn.addEventListener('click', () => {
      if (this.engine.state === 'running') void this.engine.suspend();
      else void this.engine.start();
    });
    this.modeBtns.edit.addEventListener('click', () => this.store.setPref('mode', 'edit'));
    this.modeBtns.play.addEventListener('click', () => this.store.setPref('mode', 'play'));
    this.cableBtn.addEventListener('click', () =>
      this.store.setPref('cableStyle', this.store.prefs.cableStyle === 'curved' ? 'square' : 'curved'),
    );
    this.undoBtn.addEventListener('click', () => this.store.undo());
    this.redoBtn.addEventListener('click', () => this.store.redo());
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        if (e.shiftKey) this.store.redo();
        else this.store.undo();
      }
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
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Canvas mode' }, this.modeBtns.edit, this.modeBtns.play),
      this.cableBtn,
      this.undoBtn,
      this.redoBtn,
      h('button', { class: 'add-btn', onclick: () => this.openPalette() }, '+ Module'),
      h('button', { onclick: () => this.canvas.fit() }, 'Fit'),
      h('button', { onclick: () => void this.openPatches() }, 'Patches'),
      this.audioBtn,
    );

    this.root.replaceChildren(header, h('div', { class: 'workspace' }, this.canvas.el, this.inspector.el), this.overlay);
    this.store.subscribe(() => this.render());
    this.engine.onState((s) => this.renderAudio(s));
    this.render();
    this.loop();
  }

  private render(): void {
    const p = this.store.patch;
    this.engine.sync(p);
    if (document.activeElement !== this.nameInput) this.nameInput.value = p.name;
    this.saveEl.textContent =
      this.store.saveState === 'saving' ? 'Saving…' : this.store.saveState === 'error' ? 'Not saved' : 'Saved';
    this.saveEl.dataset.state = this.store.saveState;
    this.undoBtn.disabled = !this.store.canUndo;
    this.redoBtn.disabled = !this.store.canRedo;
    for (const mode of ['edit', 'play'] as const) {
      this.modeBtns[mode].setAttribute('aria-pressed', String(this.store.prefs.mode === mode));
    }
    const square = this.store.prefs.cableStyle === 'square';
    this.cableBtn.textContent = square ? '⌐' : '∿';
    this.cableBtn.setAttribute('aria-label', square ? 'Cables: right-angle. Tap for curved' : 'Cables: curved. Tap for right-angle');
    this.cableBtn.title = this.cableBtn.getAttribute('aria-label')!;
    this.canvas.render();
    this.inspector.render();
  }

  /** Drives playheads and other live displays. */
  private loop(): void {
    const state = (id: string) => this.engine.moduleState(id);
    const frame = () => {
      if (this.engine.state === 'running') {
        this.canvas.tick(state);
        this.inspector.tick(state);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private renderAudio(s: EngineState): void {
    this.audioBtn.textContent =
      s === 'running' ? 'Audio on' : s === 'starting' ? 'Starting…' : s === 'error' ? 'Audio error' : 'Audio off';
    this.audioBtn.dataset.state = s;
    this.overlay.hidden = s !== 'off';
  }

  private openPalette(): void {
    const dialog = h('dialog', { class: 'sheet palette' });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.append(
      h('h2', {}, 'Add a module'),
      h(
        'ul',
        {},
        ...allDefs().map((d) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                onclick: () => {
                  const def = getDef(d.type)!;
                  const spot = this.canvas.freeSpot();
                  let added = '';
                  this.store.update((p) => {
                    const [next, m] = addModule(p, def, spot.x, spot.y);
                    added = m.id;
                    return next;
                  });
                  this.store.select(added);
                  close();
                },
              },
              h('strong', {}, d.label),
              d.description ? h('span', {}, d.description) : null,
            ),
          ),
        ),
      ),
      h('div', { class: 'dialog-actions' }, h('button', { onclick: close }, 'Cancel')),
    );
    dialog.addEventListener('cancel', close);
    document.body.append(dialog);
    dialog.showModal();
  }

  private async openPatches(): Promise<void> {
    const list = await this.store.storage.list();
    const dialog = h('dialog', { class: 'sheet patches' });
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
    dialog.addEventListener('cancel', close);
    document.body.append(dialog);
    dialog.showModal();
  }
}
