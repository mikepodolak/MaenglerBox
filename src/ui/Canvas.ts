import type { AppStore } from '../app/store';
import { getDef } from '../modules/registry';
import { canConnect, connect, disconnect, moveModule, PatchError, setParam } from '../patch/model';
import type { Cable, ModuleDef, ModuleInstance, Patch, PortKind, PortRef } from '../patch/types';
import { paramControl, type ParamControl } from './controls';
import { h } from './dom';
import { createFace, type Face } from './faces';

const SVG = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
/** Movement (px) below which a press counts as a tap rather than a drag. */
const TAP_SLOP = 6;

interface View {
  x: number;
  y: number;
  zoom: number;
}

interface Card {
  el: HTMLElement;
  instance: ModuleInstance;
  controls: Map<string, ParamControl>;
  face: Face | null;
}

interface JackInfo {
  module: string;
  port: string;
  side: 'in' | 'out';
  kind: PortKind;
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; view: View; moved: boolean }
  | { kind: 'pinch'; d0: number; zoom0: number; world: { x: number; y: number } }
  | { kind: 'module'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean }
  | { kind: 'cable'; from: JackInfo; path: SVGPathElement };

/**
 * The patching canvas. Modules are DOM cards on a pannable, zoomable world;
 * cables are SVG curves drawn over them. Everything is driven by pointer
 * events, so mouse, pen and touch behave the same.
 */
export class Canvas {
  readonly el = h('div', { class: 'canvas' });
  private world = h('div', { class: 'world' });
  private svg = document.createElementNS(SVG, 'svg');
  private cards = new Map<string, Card>();
  private view: View = { x: 0, y: 0, zoom: 1 };
  private viewKey = '';
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private selectedCable: string | null = null;
  private dropHint = h('div', { class: 'drop-hint', role: 'status' });

  constructor(private readonly store: AppStore) {
    this.svg.classList.add('cables');
    this.world.append(this.svg);
    this.el.append(this.world, this.dropHint);
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('pointercancel', (e) => this.onUp(e, true));
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Stop Safari's own page pinch-zoom from fighting ours.
    this.el.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  render(): void {
    const patch = this.store.patch;
    if (this.viewKey !== patch.id) this.loadView(patch);

    for (const [id, card] of this.cards) {
      if (!patch.modules.some((m) => m.id === id)) {
        card.el.remove();
        this.cards.delete(id);
      }
    }
    for (const m of patch.modules) {
      let card = this.cards.get(m.id);
      if (!card) {
        card = this.createCard(m);
        this.cards.set(m.id, card);
        this.world.insertBefore(card.el, this.svg);
      }
      this.updateCard(card, m);
    }
    if (this.selectedCable && !patch.cables.some((c) => c.id === this.selectedCable)) this.selectedCable = null;
    this.drawCables();
  }

  /** Per-frame hook for live displays (playheads). */
  tick(state: (moduleId: string) => unknown): void {
    for (const [id, card] of this.cards) card.face?.tick?.(state(id));
  }

  /** A spot near the middle of the visible area that doesn't overlap an existing module. */
  freeSpot(width = 200, height = 220): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const c = this.toWorld(r.left + r.width / 2, r.top + r.height / 3);
    const boxes = [...this.cards.values()].map((card) => ({
      x: card.instance.x,
      y: card.instance.y,
      w: card.el.offsetWidth,
      h: card.el.offsetHeight,
    }));
    const gap = 24;
    const free = (x: number, y: number) =>
      boxes.every((b) => x + width + gap <= b.x || x >= b.x + b.w + gap || y + height + gap <= b.y || y >= b.y + b.h + gap);
    // Spiral outwards in grid steps from the centre until something fits.
    const step = 40;
    for (let ring = 0; ring < 40; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (const dy of ring === 0 ? [0] : [-ring, ring]) {
          const x = Math.round(c.x - width / 2 + dx * step);
          const y = Math.round(c.y + dy * step);
          if (free(x, y)) return { x, y };
        }
      }
      for (let dy = -ring + 1; dy <= ring - 1; dy++) {
        for (const dx of [-ring, ring]) {
          const x = Math.round(c.x - width / 2 + dx * step);
          const y = Math.round(c.y + dy * step);
          if (free(x, y)) return { x, y };
        }
      }
    }
    return { x: Math.round(c.x - width / 2), y: Math.round(c.y) };
  }

  /** Bring every module into view. */
  fit(): void {
    const mods = this.store.patch.modules;
    if (!mods.length) return;
    const r = this.el.getBoundingClientRect();
    const minX = Math.min(...mods.map((m) => m.x));
    const minY = Math.min(...mods.map((m) => m.y));
    const maxX = Math.max(...mods.map((m) => m.x + (this.cards.get(m.id)?.el.offsetWidth ?? 200)));
    const maxY = Math.max(...mods.map((m) => m.y + (this.cards.get(m.id)?.el.offsetHeight ?? 200)));
    const pad = 32;
    const zoom = clamp(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)), MIN_ZOOM, 1.2);
    this.setView({
      zoom,
      x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  }

  // --- cards ---------------------------------------------------------------

  private createCard(m: ModuleInstance): Card {
    const def = getDef(m.type)!;
    const jack = (side: 'in' | 'out', p: ModuleDef['inputs'][number]) =>
      h('span', {
        class: `jack ${p.kind}`,
        'data-jack': JSON.stringify({ module: m.id, port: p.id, side, kind: p.kind } satisfies JackInfo),
        title: `${p.label} (${p.kind})`,
      });
    const controls = new Map<string, ParamControl>();
    const faceParams = (def.face ?? []).map((id) => def.params.find((p) => p.id === id)!).filter(Boolean);
    for (const p of faceParams) {
      controls.set(
        p.id,
        paramControl(p, m.params[p.id], (v) => this.store.update((x) => setParam(x, getDef, m.id, p.id, v), `param:${m.id}:${p.id}`), true),
      );
    }
    const face = createFace(m);
    const el = h(
      'article',
      { class: `node node-${m.type}`, 'data-module': m.id },
      h('header', { class: 'node-head' }, def.label),
      h(
        'div',
        { class: 'node-ports' },
        h('div', { class: 'ins' }, ...def.inputs.map((p) => h('div', { class: 'port-row' }, jack('in', p), h('span', {}, p.label)))),
        h('div', { class: 'outs' }, ...def.outputs.map((p) => h('div', { class: 'port-row' }, h('span', {}, p.label), jack('out', p)))),
      ),
      face?.el ?? null,
      controls.size ? h('div', { class: 'node-face' }, ...[...controls.values()].map((c) => c.el)) : null,
    );
    return { el, instance: m, controls, face };
  }

  private updateCard(card: Card, m: ModuleInstance): void {
    card.instance = m;
    const dragging = this.gesture?.kind === 'module' && this.gesture.id === m.id;
    if (!dragging) {
      card.el.style.left = `${m.x}px`;
      card.el.style.top = `${m.y}px`;
    }
    card.el.classList.toggle('selected', this.store.selected === m.id);
    for (const [id, c] of card.controls) c.set(m.params[id]);
    card.face?.update(m);
  }

  // --- cables --------------------------------------------------------------

  private jackEl(ref: PortRef, side: 'in' | 'out'): HTMLElement | null {
    const card = this.cards.get(ref.module);
    if (!card) return null;
    for (const j of card.el.querySelectorAll<HTMLElement>('.jack')) {
      const info = jackInfo(j);
      if (info && info.port === ref.port && info.side === side) return j;
    }
    return null;
  }

  private jackPos(el: HTMLElement): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  private drawCables(): void {
    const patch = this.store.patch;
    const frag = document.createDocumentFragment();
    for (const c of patch.cables) {
      const a = this.jackEl(c.from, 'out');
      const b = this.jackEl(c.to, 'in');
      if (!a || !b) continue;
      const p1 = this.jackPos(a);
      const p2 = this.jackPos(b);
      const d = cablePath(p1, p2);
      const kind = jackInfo(a)?.kind ?? 'audio';
      const selected = c.id === this.selectedCable;
      const hit = svgEl('path', { d, class: 'cable-hit', 'data-cable': c.id });
      const line = svgEl('path', { d, class: `cable ${kind}${selected ? ' selected' : ''}` });
      frag.append(line, hit);
      if (selected) frag.append(this.deleteHandle(c, p1, p2));
    }
    // Keep an in-progress drag cable on top.
    const live = this.gesture?.kind === 'cable' ? this.gesture.path : null;
    this.svg.replaceChildren(frag);
    if (live) this.svg.append(live);
  }

  private deleteHandle(c: Cable, p1: { x: number; y: number }, p2: { x: number; y: number }): SVGElement {
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 + sag(p1, p2) * 0.75 };
    const g = svgEl('g', { class: 'cable-delete', 'data-delete-cable': c.id, transform: `translate(${mid.x} ${mid.y})` });
    g.append(svgEl('circle', { r: '14' }), svgEl('path', { d: 'M-5-5L5 5M5-5L-5 5' }));
    return g;
  }

  // --- gestures ------------------------------------------------------------

  private onDown(e: PointerEvent): void {
    const target = e.target as Element;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const del = target.closest('[data-delete-cable]');
    if (del) {
      const id = del.getAttribute('data-delete-cable')!;
      this.selectedCable = null;
      this.store.update((p) => disconnect(p, id));
      return;
    }

    // Jacks win over cables lying on top of them, or a plugged jack could never be grabbed.
    const jack = jackElAt(e.clientX, e.clientY);
    if (jack) {
      e.preventDefault();
      this.startCableDrag(e, jack);
      return;
    }

    const cable = target.closest('[data-cable]');
    if (cable) {
      this.selectedCable = cable.getAttribute('data-cable');
      this.drawCables();
      return;
    }

    const head = target.closest<HTMLElement>('.node-head');
    if (head) {
      const id = head.closest<HTMLElement>('.node')!.dataset.module!;
      const m = this.store.patch.modules.find((x) => x.id === id)!;
      this.el.setPointerCapture(e.pointerId);
      this.gesture = { kind: 'module', id, startX: e.clientX, startY: e.clientY, origX: m.x, origY: m.y, moved: false };
      return;
    }

    const node = target.closest<HTMLElement>('.node');
    if (node) {
      this.store.select(node.dataset.module!);
      return;
    }

    // Background: one finger pans, two pinch.
    this.el.setPointerCapture(e.pointerId);
    const bg = [...this.pointers.values()];
    if (bg.length >= 2 && (this.gesture?.kind === 'pan' || this.gesture?.kind === 'pinch' || !this.gesture)) {
      const [a, b] = bg;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = { kind: 'pinch', d0: dist(a, b), zoom0: this.view.zoom, world: this.toWorld(mid.x, mid.y) };
    } else if (!this.gesture) {
      this.gesture = { kind: 'pan', startX: e.clientX, startY: e.clientY, view: { ...this.view }, moved: false };
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pan') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
      if (g.moved) this.setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else if (g.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const zoom = clamp(g.zoom0 * (dist(a, b) / g.d0), MIN_ZOOM, MAX_ZOOM);
      const mid = this.toLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.setView({ zoom, x: mid.x - g.world.x * zoom, y: mid.y - g.world.y * zoom });
    } else if (g.kind === 'module') {
      const dx = (e.clientX - g.startX) / this.view.zoom;
      const dy = (e.clientY - g.startY) / this.view.zoom;
      if (Math.hypot(dx, dy) * this.view.zoom > TAP_SLOP) g.moved = true;
      if (!g.moved) return;
      const card = this.cards.get(g.id)!;
      card.el.style.left = `${Math.round(g.origX + dx)}px`;
      card.el.style.top = `${Math.round(g.origY + dy)}px`;
      card.el.classList.add('dragging');
      this.drawCables();
    } else if (g.kind === 'cable') {
      const start = this.jackEl({ module: g.from.module, port: g.from.port }, g.from.side);
      if (!start) return;
      const p = this.toWorld(e.clientX, e.clientY);
      const s = this.jackPos(start);
      g.path.setAttribute('d', g.from.side === 'out' ? cablePath(s, p) : cablePath(p, s));
      this.highlightTarget(e);
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pinch') {
      // Lifting one finger of a pinch shouldn't turn into a pan jump.
      if (this.pointers.size === 0) this.gesture = null;
      this.saveView();
      return;
    }
    this.gesture = null;

    if (g.kind === 'pan') {
      if (!g.moved && !cancelled) {
        this.store.select(null);
        this.selectedCable = null;
        this.drawCables();
      }
      this.saveView();
    } else if (g.kind === 'module') {
      const card = this.cards.get(g.id)!;
      card.el.classList.remove('dragging');
      if (!g.moved) {
        this.store.select(g.id);
        return;
      }
      const x = parseFloat(card.el.style.left);
      const y = parseFloat(card.el.style.top);
      this.store.update((p) => moveModule(p, g.id, x, y));
    } else if (g.kind === 'cable') {
      this.clearHighlights();
      g.path.remove();
      if (!cancelled) this.finishCable(g.from, e);
      this.drawCables();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey) {
      // Trackpad pinch arrives as ctrl+wheel.
      const zoom = clamp(this.view.zoom * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
      const local = this.toLocal(e.clientX, e.clientY);
      const world = this.toWorld(e.clientX, e.clientY);
      this.setView({ zoom, x: local.x - world.x * zoom, y: local.y - world.y * zoom });
    } else {
      this.setView({ ...this.view, x: this.view.x - e.deltaX, y: this.view.y - e.deltaY });
    }
    this.saveView();
  }

  private startCableDrag(e: PointerEvent, jack: HTMLElement): void {
    let from = jackInfo(jack)!;
    // Grabbing an input that already has a cable picks that cable up, like on hardware.
    if (from.side === 'in') {
      const existing = [...this.store.patch.cables].reverse().find((c) => c.to.module === from.module && c.to.port === from.port);
      if (existing) {
        this.store.update((p) => disconnect(p, existing.id));
        const src = this.jackEl(existing.from, 'out');
        if (src) from = jackInfo(src)!;
      }
    }
    this.el.setPointerCapture(e.pointerId);
    const path = svgEl('path', { class: `cable ${from.kind} live` }) as SVGPathElement;
    this.gesture = { kind: 'cable', from, path };
    this.svg.append(path);
    for (const j of this.el.querySelectorAll<HTMLElement>('.jack')) {
      const info = jackInfo(j)!;
      const ok =
        info.side !== from.side &&
        info.module !== from.module &&
        (from.side === 'out' ? canConnect(from.kind, info.kind) : canConnect(info.kind, from.kind));
      j.classList.toggle('can-drop', ok);
      j.classList.toggle('no-drop', !ok);
    }
    this.onMove(e);
  }

  private finishCable(from: JackInfo, e: PointerEvent): void {
    const target = jackAt(e.clientX, e.clientY);
    if (!target || target.side === from.side) return;
    const [out, inp] = from.side === 'out' ? [from, target] : [target, from];
    try {
      this.store.update((p) => connect(p, getDef, { module: out.module, port: out.port }, { module: inp.module, port: inp.port })[0]);
    } catch (err) {
      this.hint(err instanceof PatchError ? err.message : 'Could not connect');
    }
  }

  private highlightTarget(e: PointerEvent): void {
    const over = jackElAt(e.clientX, e.clientY);
    for (const j of this.el.querySelectorAll('.jack.hover')) if (j !== over) j.classList.remove('hover');
    over?.classList.add('hover');
  }

  private clearHighlights(): void {
    for (const j of this.el.querySelectorAll('.jack')) j.classList.remove('can-drop', 'no-drop', 'hover');
  }

  private hint(text: string): void {
    this.dropHint.textContent = text;
    this.dropHint.classList.add('show');
    setTimeout(() => this.dropHint.classList.remove('show'), 2200);
  }

  // --- view ----------------------------------------------------------------

  private setView(v: View): void {
    this.view = v;
    this.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    this.el.style.setProperty('--zoom', String(v.zoom));
  }

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const l = this.toLocal(clientX, clientY);
    return { x: (l.x - this.view.x) / this.view.zoom, y: (l.y - this.view.y) / this.view.zoom };
  }

  private loadView(patch: Patch): void {
    this.viewKey = patch.id;
    try {
      const saved = JSON.parse(localStorage.getItem(`maenglerbox:view:${patch.id}`) ?? 'null');
      if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite)) {
        this.setView(saved);
        return;
      }
    } catch {
      // No saved view; fall through to fitting.
    }
    this.setView({ x: 0, y: 0, zoom: 1 });
    requestAnimationFrame(() => this.fit());
  }

  private saveView(): void {
    try {
      localStorage.setItem(`maenglerbox:view:${this.viewKey}`, JSON.stringify(this.view));
    } catch {
      // Storage unavailable: the view just won't be remembered.
    }
  }
}

function jackInfo(el: Element): JackInfo | null {
  const raw = el.getAttribute('data-jack');
  return raw ? (JSON.parse(raw) as JackInfo) : null;
}

/** The jack under a point, looking through cables. Jacks have a generous invisible hit area for fingers. */
function jackElAt(x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const jack = el.closest<HTMLElement>('.jack');
    if (jack) return jack;
    if (el.closest('.node')) return null;
  }
  return null;
}

function jackAt(x: number, y: number): JackInfo | null {
  const el = jackElAt(x, y);
  return el ? jackInfo(el) : null;
}

function sag(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return 24 + dist(a, b) * 0.12;
}

export function cablePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  const s = sag(a, b);
  return `M${a.x} ${a.y}C${a.x + dx} ${a.y + s} ${b.x - dx} ${b.y + s} ${b.x} ${b.y}`;
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
