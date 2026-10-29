import type { AppStore } from '../app/store';
import type { AudioEngine, EngineState } from '../engine/AudioEngine';
import { allDefs, getDef } from '../modules/registry';
import { addModule } from '../patch/model';
import { MODULE_CATEGORIES } from '../patch/types';
import { Canvas } from './Canvas';
import { h } from './dom';
import { openHelp, setHelpPlacer } from './help';
import { Inspector } from './Inspector';
import { openSheet } from './sheet';

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
  private recBtn = h('button', { class: 'rec-btn', title: 'Record the audio output' });

  constructor(
    private readonly root: HTMLElement,
    private readonly store: AppStore,
    private readonly engine: AudioEngine,
  ) {
    this.canvas = new Canvas(store);
    this.inspector = new Inspector(store);
    setHelpPlacer(() => this.canvas.freeSpot(440, 600));
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
    this.recBtn.addEventListener('click', () => void this.toggleRecording());
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
      this.recBtn,
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
    this.engine.sync(p, this.store.library);
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
    this.paintRec();
    this.canvas.render();
    this.inspector.render();
  }

  private paintRec(): void {
    const on = this.engine.recording;
    const t = Math.floor(this.engine.recordedSeconds());
    this.recBtn.textContent = on ? `■ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '● Rec';
    this.recBtn.classList.toggle('on', on);
    this.recBtn.setAttribute('aria-label', on ? 'Stop recording' : 'Record the audio output');
  }

  /** Drives playheads and other live displays. */
  private loop(): void {
    const state = (id: string) => this.engine.moduleState(id);
    const frame = () => {
      if (this.engine.state === 'running') {
        this.canvas.tick(state);
        this.inspector.tick(state);
      }
      if (this.engine.recording) this.paintRec();
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
    const sheet = openSheet(
      'Add a module',
      'palette',
      // Grouped by category, so a growing module list stays easy to scan.
      ...MODULE_CATEGORIES.flatMap((cat) => {
        const defs = allDefs().filter((d) => (d.category ?? 'Utility') === cat);
        if (!defs.length) return [];
        return [
          h('h3', { class: 'palette-cat' }, cat),
          h(
            'ul',
            {},
            ...defs.map((d) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    onclick: () => {
                      const def = getDef(d.type)!;
                      const spot = this.canvas.freeSpot(200, Canvas.cardHeight(def));
                      let added = '';
                      this.store.update((p) => {
                        const [next, m] = addModule(p, def, spot.x, spot.y);
                        added = m.id;
                        return next;
                      });
                      this.store.select(added);
                      sheet.close();
                    },
                  },
                  h('strong', {}, d.label),
                  d.description ? h('span', {}, d.description) : null,
                ),
                h('button', { class: 'icon help-btn', 'aria-label': `About ${d.label}`, onclick: () => openHelp(this.store, d.type) }, '?'),
              ),
            ),
          ),
        ];
      }),
    );
  }

  private async openPatches(): Promise<void> {
    const list = h('ul', {});
    const sheet = openSheet(
      'Patches',
      'patches',
      list,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { onclick: () => { this.store.newPatch(); sheet.close(); } }, 'New patch'),
      ),
    );
    const fill = async () => {
      const rows = await this.store.storage.list();
      list.replaceChildren(
        ...rows.map((s) =>
          h(
            'li',
            { class: 'patch-row' },
            h(
              'button',
              {
                class: s.id === this.store.patch.id ? 'open-patch current' : 'open-patch',
                onclick: () => {
                  void this.store.open(s.id);
                  sheet.close();
                },
              },
              h('strong', {}, s.name),
              h('time', {}, new Date(s.updatedAt).toLocaleString()),
            ),
            h('button', {
              class: 'icon',
              'aria-label': `Rename ${s.name}`,
              title: 'Rename',
              onclick: async () => {
                const name = prompt('Patch name', s.name);
                if (name === null) return;
                await this.store.renamePatch(s.id, name);
                await fill();
              },
            }, '✎'),
            h('button', {
              class: 'icon danger',
              'aria-label': `Delete ${s.name}`,
              title: 'Delete',
              onclick: async () => {
                if (!confirm(`Delete "${s.name}"? This can't be undone.`)) return;
                await this.store.deletePatch(s.id);
                await fill();
              },
            }, '🗑'),
          ),
        ),
      );
    };
    await fill();
  }

  private async toggleRecording(): Promise<void> {
    if (!this.engine.recording) {
      if (this.engine.state !== 'running') await this.engine.start();
      if (!this.engine.startRecording()) alert("This browser can't record audio.");
      this.render();
      return;
    }
    const blob = await this.engine.stopRecording();
    this.render();
    if (blob) this.showRecording(blob);
  }

  private showRecording(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const filename = `${this.store.patch.name} ${stamp}.${ext}`;
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    const canShare = !!nav.share && !!nav.canShare?.({ files: [file] });
    const sheet = openSheet(
      'Recording',
      'recording',
      h('p', { class: 'hint' }, filename),
      h('audio', { controls: true, src: url, class: 'rec-player' }),
      h(
        'div',
        { class: 'dialog-actions' },
        canShare ? h('button', { onclick: () => void nav.share({ files: [file], title: filename }).catch(() => {}) }, 'Share / Save to Files') : null,
        h('a', { class: 'button', href: url, download: filename }, 'Download'),
      ),
    );
    sheet.dialog.addEventListener('close', () => setTimeout(() => URL.revokeObjectURL(url), 60_000));
  }
}
