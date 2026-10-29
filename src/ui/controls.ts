import { formatParam, fromNormalized, toNormalized } from '../patch/params';
import type { ParamDef } from '../patch/types';
import { h } from './dom';

const STEPS = 1000;

export interface ParamControl {
  el: HTMLElement;
  /** Show a new value without disturbing a drag in progress. */
  set(value: number): void;
  /** Show whether the param is locked against randomize. */
  setLocked(locked: boolean): void;
  /** Show where a cable is moving the setting right now, or null when nothing is. */
  setMod(value: number | null): void;
}

/** Small padlock toggle shown before a param's label. */
function lockButton(label: string, onToggle: () => void): { el: HTMLButtonElement; set(locked: boolean): void } {
  const el = h('button', { class: 'lock', type: 'button' });
  el.addEventListener('click', (e) => {
    e.preventDefault();
    onToggle();
  });
  const set = (locked: boolean) => {
    el.classList.toggle('locked', locked);
    el.textContent = locked ? '🔒' : '🔓';
    el.setAttribute('aria-pressed', String(locked));
    el.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${label} for randomize`);
  };
  set(false);
  return { el, set };
}

/**
 * Labelled slider with a readout. Choice params (with `options`) get a
 * dropdown instead, which is easier to hit on a phone than a stepped slider.
 */
export function paramControl(
  p: ParamDef,
  value: number,
  onChange: (v: number) => void,
  compact = false,
  onToggleLock?: () => void,
): ParamControl {
  const readout = h('output', {});
  const lock = onToggleLock ? lockButton(p.label, onToggleLock) : null;
  const cls = `${compact ? 'param compact' : 'param'}${lock ? ' lockable' : ''}`;
  const setLocked = (locked: boolean) => lock?.set(locked);
  const label = () => h('span', { class: 'param-label' }, lock?.el ?? null, p.label);

  if (p.options) {
    const select = h(
      'select',
      { 'aria-label': p.label },
      ...p.options.map((o, i) => h('option', { value: String(p.min + i) }, o)),
    );
    select.addEventListener('change', () => onChange(Number(select.value)));
    const set = (v: number) => {
      if (document.activeElement !== select) select.value = String(Math.round(v));
    };
    set(value);
    const el = h('label', { class: `${cls} choice` }, label(), select);
    let shown: number | null = null;
    // A choice can't show a moving marker, so the option the cable has picked is named beside it.
    const setMod = (v: number | null) => {
      if (v === shown) return;
      shown = v;
      el.classList.toggle('modded', v !== null);
      if (v === null) delete el.dataset.live;
      else el.dataset.live = `→ ${formatParam(p, v)}`;
    };
    return { el, set, setLocked, setMod };
  }

  const slider = h('input', { type: 'range', min: 0, max: STEPS, step: 1, 'aria-label': p.label });
  let dragging = false;
  slider.addEventListener('pointerdown', () => (dragging = true));
  slider.addEventListener('pointerup', () => (dragging = false));
  slider.addEventListener('pointercancel', () => (dragging = false));
  slider.addEventListener('input', () => {
    const v = fromNormalized(p, Number(slider.value) / STEPS);
    readout.textContent = formatParam(p, v);
    onChange(v);
  });
  // Double-tap returns to default, a common convention in synth UIs.
  slider.addEventListener('dblclick', () => onChange(p.default));
  let base = value;
  let live: number | null = null;
  const set = (v: number) => {
    base = v;
    readout.textContent = formatParam(p, live ?? v);
    if (!dragging) slider.value = String(Math.round(toNormalized(p, v) * STEPS));
  };
  set(value);
  // The thumb stays where you set it; a marker on the track shows where cables have moved it to.
  const mark = h('i', { class: 'mod-mark', 'aria-hidden': 'true' });
  const track = h('span', { class: 'slider-wrap' }, slider, mark);
  const el = h('label', { class: cls }, label(), track, readout);
  const setMod = (v: number | null) => {
    if (v === live) return;
    live = v;
    el.classList.toggle('modded', v !== null);
    if (v !== null) track.style.setProperty('--mod', String(toNormalized(p, v)));
    readout.textContent = formatParam(p, v ?? base);
  };
  return { el, set, setLocked, setMod };
}
