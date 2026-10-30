import { EUCLID_COLORS, EUCLID_RINGS, euclidHit, ringSettings, turingLoop } from '../modules/generative';
import { lfoShape } from '../dsp/lfo';
import { LIFE_COLS, LIFE_ROWS } from '../modules/life';
import { MATRIX_SIZE, type MatrixData } from '../modules/matrix';
import { NOTE_NAMES, SCALES } from '../modules/sequencer';
import { LIGHT_COLORS, toDb } from '../modules/mixing';
import type { MarkovData } from '../modules/markov';
import type { SequencerData } from '../modules/sequencer';
import type { ModuleInstance } from '../patch/types';
import { h } from './dom';

/** A custom display on a module's card, beyond its param sliders. */
export interface Face {
  el: HTMLElement;
  update(m: ModuleInstance): void;
  /** Called every animation frame with the module's live state. */
  tick?(state: unknown): void;
}

export function createFace(m: ModuleInstance): Face | null {
  if (m.type === 'sequencer') return sequencerFace();
  if (m.type === 'euclid') return euclidFace();
  if (m.type === 'markov') return markovFace();
  if (m.type === 'lfo') return lfoFace();
  if (m.type === 'matrix') return matrixFace();
  if (m.type === 'conductor') return conductorFace();
  if (m.type === 'meter') return meterFace();
  if (m.type === 'light') return lightFace();
  if (m.type === 'mixer') return mixerFace();
  if (m.type === 'filter' || m.type === 'eq') return curveFace(m.type === 'eq');
  if (m.type === 'turing') return turingFace();
  if (m.type === 'random') return probabilityFace();
  if (m.type === 'chance') return chanceFace();
  if (m.type === 'sh') return holdFace();
  if (m.type === 'balls') return ballsFace();
  if (m.type === 'life') return lifeFace();
  return null;
}

/** Four bars, as tall as their weights, in a neutral grey; the one just picked lights up. */
function probabilityFace(): Face {
  const el = h('div', { class: 'prob-bars face-visual', 'aria-hidden': 'true' });
  const bars = Array.from({ length: 4 }, (_, i) => el.appendChild(h('span', {}, h('i', {}), h('b', {}, String(i + 1)))));
  let last = -2;
  return {
    el,
    update(m) {
      const w = bars.map((_, i) => m.params[`w${i + 1}`] ?? 0);
      const max = Math.max(0.0001, ...w);
      bars.forEach((b, i) => b.style.setProperty('--h', String(w[i] / max)));
    },
    tick(state) {
      const pick = (state as { pick?: number } | undefined)?.pick ?? -1;
      if (pick === last) return;
      bars.forEach((b, i) => b.classList.toggle('lit', i === pick));
      last = pick;
    },
  };
}

/** Two lamps, A and B; the side the last event took flashes. */
function chanceFace(): Face {
  const el = h('div', { class: 'chance-lamps face-visual', 'aria-hidden': 'true' });
  const a = el.appendChild(h('span', {}, 'A'));
  const b = el.appendChild(h('span', {}, 'B'));
  let last = '';
  return {
    el,
    update() {},
    tick(state) {
      const side = (state as { side?: string } | undefined)?.side ?? '';
      if (side === last) return;
      a.classList.toggle('lit', side === 'a');
      b.classList.toggle('lit', side === 'b');
      last = side;
    },
  };
}

/** A canvas whose backing store follows its on-screen size, so resized cards stay sharp. */
function liveCanvas(cls: string, aspect: number) {
  const el = h('canvas', { class: `face-canvas face-visual ${cls}`, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  el.style.aspectRatio = String(aspect);
  const g = el.getContext('2d');
  return {
    el,
    /** The context scaled to CSS pixels, and the drawing size, or null when hidden. */
    begin(): { g: CanvasRenderingContext2D; w: number; h: number } | null {
      const w = el.clientWidth;
      if (!g || !w) return null;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const hgt = w / aspect;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(hgt * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hgt);
      return { g, w, h: hgt };
    },
  };
}

/** One cycle of the wave, with a dot riding it where the LFO is now. */
function lfoFace(): Face {
  const c = liveCanvas('lfo-face', 3);
  // Fixed random steps, so the random shapes have something to show.
  const steps = [0.2, -0.7, 0.9, -0.1, 0.5, -0.9, 0.1, 0.7, -0.4];
  const at = (shape: number, x: number) => {
    if (shape < 5) return lfoShape(shape, x);
    const i = Math.min(steps.length - 2, Math.floor(x * 4));
    return lfoShape(shape, x * 4 - i, steps[i], steps[i + 1]);
  };
  let shape = -1;
  let phase = 0;
  const draw = () => {
    const d = c.begin();
    if (!d || shape < 0) return;
    const pad = 6;
    const y = (v: number) => d.h / 2 - v * (d.h / 2 - pad);
    d.g.strokeStyle = '#3a3e46';
    d.g.lineWidth = 1;
    d.g.beginPath();
    d.g.moveTo(0, d.h / 2);
    d.g.lineTo(d.w, d.h / 2);
    d.g.stroke();
    d.g.strokeStyle = '#4fd1c5';
    d.g.lineWidth = 2;
    d.g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const x = i / 120;
      const px = x * d.w;
      if (i) d.g.lineTo(px, y(at(shape, x)));
      else d.g.moveTo(px, y(at(shape, x)));
    }
    d.g.stroke();
    // Random shapes repeat four steps across the drawing, so the dot follows one of them.
    const x = shape < 5 ? phase : phase / 4;
    d.g.fillStyle = '#ffffff';
    d.g.beginPath();
    d.g.arc(x * d.w, y(at(shape, x)), 4, 0, Math.PI * 2);
    d.g.fill();
  };
  return {
    el: c.el,
    update(m) {
      shape = Math.round(m.params.shape);
      requestAnimationFrame(draw);
    },
    tick(state) {
      const s = state as { phase?: number } | undefined;
      phase = s?.phase ?? 0;
      draw();
    },
  };
}

interface Level {
  peak: number;
  rms: number;
}

/** Meter scale: -48 dB at the bottom to +6 dB at the top. */
const METER_FLOOR = -48;
const METER_TOP = 6;
const meterPos = (x: number) => Math.min(1, Math.max(0, (toDb(x) - METER_FLOOR) / (METER_TOP - METER_FLOOR)));

/**
 * One meter bar: green to yellow to red, the RMS solid and the peak as a line,
 * with a peak hold that falls back after a second and a clip lamp at the top.
 */
function meterBar() {
  let hold = 0;
  let holdAt = 0;
  let clipAt = -Infinity;
  return (g: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number, l: Level, dim = false) => {
    const now = performance.now();
    if (l.peak >= hold || now - holdAt > 1000) {
      hold = l.peak;
      holdAt = now;
    }
    if (l.peak >= 1) clipAt = now;
    const lamp = Math.min(6, w);
    const top = y + lamp + 2;
    const h = hgt - lamp - 2;
    g.fillStyle = '#1b1d22';
    g.fillRect(x, top, w, h);
    const grad = g.createLinearGradient(0, top + h, 0, top);
    grad.addColorStop(0, '#3fb27f');
    grad.addColorStop(0.75, '#3fb27f');
    grad.addColorStop(0.86, '#e6c84f');
    grad.addColorStop(1, '#e5534b');
    g.globalAlpha = dim ? 0.35 : 1;
    const rms = meterPos(l.rms) * h;
    g.fillStyle = grad;
    g.fillRect(x, top + h - rms, w, rms);
    g.globalAlpha = dim ? 0.2 : 0.45;
    const peak = meterPos(l.peak) * h;
    g.fillRect(x, top + h - peak, w, peak);
    g.globalAlpha = 1;
    const hy = top + h - meterPos(hold) * h;
    g.fillStyle = '#e8eaed';
    g.fillRect(x, hy - 1, w, 2);
    g.fillStyle = now - clipAt < 1500 ? '#e5534b' : '#3a1e1e';
    g.fillRect(x, y, w, lamp);
  };
}

/** A horizontal-ish card with one big bar and a dB readout. */
function meterFace(): Face {
  const c = liveCanvas('meter-face', 2.2);
  const bar = meterBar();
  let level: Level = { peak: 0, rms: 0 };
  return {
    el: c.el,
    update() {},
    tick(state) {
      level = (state as Level | undefined) ?? { peak: 0, rms: 0 };
      const d = c.begin();
      if (!d) return;
      const w = Math.min(36, d.w * 0.3);
      bar(d.g, 8, 6, w, d.h - 12, level);
      // dB marks beside the bar.
      d.g.fillStyle = '#8b9099';
      d.g.font = '10px system-ui, sans-serif';
      d.g.textBaseline = 'middle';
      const top = 6 + Math.min(6, w) + 2;
      const h = d.h - 12 - Math.min(6, w) - 2;
      for (const db of [0, -6, -12, -24, -36]) {
        const y = top + h - ((db - METER_FLOOR) / (METER_TOP - METER_FLOOR)) * h;
        d.g.fillRect(8 + w + 2, y, 4, 1);
        d.g.fillText(`${db}`, 8 + w + 9, y);
      }
      d.g.fillStyle = '#e8eaed';
      d.g.font = '600 15px system-ui, sans-serif';
      d.g.textAlign = 'right';
      const db = toDb(level.peak);
      d.g.fillText(db <= -96 ? '−∞' : `${db.toFixed(1)} dB`, d.w - 8, d.h / 2);
      d.g.textAlign = 'left';
    },
  };
}

const LIGHT_HUES = ['#4ade80', '#facc15', '#f87171', '#60a5fa', '#f1f5f9'];

/** A round lamp that glows with what's coming in. */
function lightFace(): Face {
  const el = h('div', { class: 'light-face face-visual', 'aria-hidden': 'true' }, h('span', { class: 'lamp' }));
  let last = '';
  return {
    el,
    update(m) {
      el.style.setProperty('--lamp', LIGHT_HUES[Math.round(m.params.color)] ?? LIGHT_HUES[0]);
      el.title = LIGHT_COLORS[Math.round(m.params.color)] ?? '';
    },
    tick(state) {
      const level = (state as { level?: number } | undefined)?.level ?? 0;
      const k = level.toFixed(2);
      if (k === last) return;
      last = k;
      el.style.setProperty('--on', k);
    },
  };
}

/** A meter per channel and a stereo pair for the master, like a mixing desk's bridge. */
function mixerFace(): Face {
  const c = liveCanvas('mixer-face', 2.6);
  const bars = Array.from({ length: 8 }, () => meterBar());
  return {
    el: c.el,
    update() {},
    tick(state) {
      const s = state as { channels?: (Level & { muted: boolean })[]; master?: Level[] } | undefined;
      const d = c.begin();
      if (!d || !s?.channels || !s.master) return;
      const n = s.channels.length + 2;
      const gap = 4;
      const w = (d.w - 16 - gap * (n + 1)) / n;
      d.g.font = '10px system-ui, sans-serif';
      d.g.textAlign = 'center';
      d.g.textBaseline = 'alphabetic';
      const draw = (i: number, l: Level, label: string, dim = false) => {
        const x = 8 + gap + i * (w + gap) + (i >= s.channels!.length ? gap * 2 : 0);
        bars[i](d.g, x, 4, w, d.h - 18, l, dim);
        d.g.fillStyle = dim ? '#5b6069' : '#8b9099';
        d.g.fillText(label, x + w / 2, d.h - 3);
      };
      s.channels.forEach((ch, i) => draw(i, ch, String(i + 1), ch.muted));
      draw(s.channels.length, s.master[0], 'L');
      draw(s.channels.length + 1, s.master[1], 'R');
    },
  };
}

/** A filter's or EQ's response, redrawn when its settings (or a cable on them) move it. */
function curveFace(eq: boolean): Face {
  const c = liveCanvas(eq ? 'eq-face' : 'filter-face', 2.4);
  let curve: Float32Array | null = null;
  const draw = () => {
    const d = c.begin();
    if (!d || !curve) return;
    // EQ: ±18 dB around the middle. Filter: +18 dB down to -42 dB.
    const top = 18;
    const bottom = eq ? -18 : -42;
    const y = (db: number) => ((top - Math.min(top, Math.max(bottom, db))) / (top - bottom)) * d.h;
    d.g.strokeStyle = '#2c2f35';
    d.g.lineWidth = 1;
    for (const f of [100, 1000, 10000]) {
      const x = (Math.log(f / 20) / Math.log(1000)) * d.w;
      d.g.beginPath();
      d.g.moveTo(x, 0);
      d.g.lineTo(x, d.h);
      d.g.stroke();
    }
    d.g.beginPath();
    d.g.moveTo(0, y(0));
    d.g.lineTo(d.w, y(0));
    d.g.stroke();
    d.g.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * d.w;
      if (i) d.g.lineTo(x, y(curve[i]));
      else d.g.moveTo(x, y(curve[i]));
    }
    d.g.strokeStyle = '#f08a4b';
    d.g.lineWidth = 2;
    d.g.stroke();
    d.g.lineTo(d.w, d.h);
    d.g.lineTo(0, d.h);
    d.g.closePath();
    d.g.fillStyle = 'rgba(240, 138, 75, 0.12)';
    d.g.fill();
  };
  return {
    el: c.el,
    update() {},
    tick(state) {
      const next = (state as { curve?: Float32Array } | undefined)?.curve ?? null;
      if (next === curve && c.el.dataset.w === String(c.el.clientWidth)) return;
      curve = next;
      c.el.dataset.w = String(c.el.clientWidth);
      draw();
    },
  };
}

/** The routing grid as dials, rows = inputs, columns = outputs; crossings that just fired light up. */
function matrixFace(): Face {
  const c = liveCanvas('matrix-face', 1);
  let data: MatrixData | null = null;
  let key = '';
  let lit: number[] = [];
  let rows: number[] = [];
  const draw = () => {
    const k = `${lit.join(',')}|${rows.join(',')}|${c.el.clientWidth}`;
    if (k === key || !data) return;
    key = k;
    const d = c.begin();
    if (!d) return;
    const cell = d.w / MATRIX_SIZE;
    for (const r of rows) {
      d.g.fillStyle = 'rgba(240, 138, 75, 0.12)';
      d.g.fillRect(0, r * cell, d.w, cell);
    }
    for (let r = 0; r < MATRIX_SIZE; r++) {
      for (let col = 0; col < MATRIX_SIZE; col++) {
        const w = data.weights[r][col];
        const cx = col * cell + cell / 2;
        const cy = r * cell + cell / 2;
        d.g.fillStyle = '#2c2f35';
        d.g.beginPath();
        d.g.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
        d.g.fill();
        if (!w) continue;
        d.g.fillStyle = lit.includes(r * MATRIX_SIZE + col) ? '#ffd2b0' : '#f08a4b';
        d.g.beginPath();
        d.g.arc(cx, cy, cell * 0.42 * Math.sqrt(w / 100), 0, Math.PI * 2);
        d.g.fill();
      }
    }
  };
  return {
    el: c.el,
    update(m) {
      data = m.data as MatrixData;
      key = '';
      requestAnimationFrame(draw);
    },
    tick(state) {
      const s = state as { lit?: number[]; rows?: number[] } | undefined;
      lit = s?.lit ?? [];
      rows = s?.rows ?? [];
      draw();
    },
  };
}

/** The key as a big name over a one-octave keyboard with the scale's notes lit. */
function conductorFace(): Face {
  const name = h('div', { class: 'conductor-key' });
  const keys = Array.from({ length: 12 }, (_, i) => h('span', { class: [1, 3, 6, 8, 10].includes(i) ? 'black' : 'white' }));
  const el = h('div', { class: 'conductor-face face-visual', 'aria-hidden': 'true' }, name, h('div', { class: 'conductor-keys' }, ...keys));
  return {
    el,
    update(m) {
      const root = Math.round(m.params.root);
      const scale = SCALES[Math.round(m.params.scale)] ?? SCALES[0];
      const on = m.params.enabled >= 0.5;
      name.textContent = on ? `${NOTE_NAMES[root]} ${scale.name}` : 'Off';
      el.classList.toggle('off', !on);
      keys.forEach((k, i) => {
        const deg = (i - root + 12) % 12;
        k.classList.toggle('in', scale.intervals.includes(deg));
        k.classList.toggle('root', deg === 0);
      });
    },
  };
}

/** The last few held values as steps, newest on the right. */
function holdFace(): Face {
  const c = liveCanvas('hold-face', 3.5);
  const values: number[] = [];
  let last = -2;
  return {
    el: c.el,
    update() {},
    tick(state) {
      const v = (state as { value?: number } | undefined)?.value ?? -1;
      if (v === last || v < 0) return;
      last = v;
      values.push(v);
      if (values.length > 16) values.shift();
      const d = c.begin();
      if (!d) return;
      const step = d.w / 16;
      d.g.strokeStyle = '#6fd1c4';
      d.g.lineWidth = 2;
      d.g.beginPath();
      values.forEach((x, i) => {
        const px = d.w - (values.length - i) * step;
        const py = d.h - 4 - x * (d.h - 8);
        if (i === 0) d.g.moveTo(px, py);
        else d.g.lineTo(px, py);
        d.g.lineTo(px + step, py);
      });
      d.g.stroke();
    },
  };
}

/**
 * The transition matrix as a grid of dials, like Max's matrixctrl in dial
 * mode: each circle's size is the weight from its row's state to its
 * column's. The row the chain is on is lit, and the move it just made glows.
 */
function markovFace(): Face {
  const c = liveCanvas('markov-face', 1);
  let data: MarkovData | null = null;
  let size = 8;
  let key = '';
  let live = { state: -1, prev: -1 };
  const draw = () => {
    const k = `${live.state}:${live.prev}:${c.el.clientWidth}`;
    if (k === key || !data) return;
    key = k;
    const d = c.begin();
    if (!d) return;
    const cell = d.w / size;
    const max = Math.max(1, ...data.weights.slice(0, size).flatMap((r) => r.slice(0, size)));
    if (live.state >= 0) {
      d.g.fillStyle = 'rgba(79, 179, 255, 0.12)';
      d.g.fillRect(0, live.state * cell, d.w, cell);
    }
    for (let r = 0; r < size; r++) {
      for (let col = 0; col < size; col++) {
        const w = data.weights[r][col];
        const cx = col * cell + cell / 2;
        const cy = r * cell + cell / 2;
        d.g.fillStyle = '#2c2f35';
        d.g.beginPath();
        d.g.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
        d.g.fill();
        if (!w) continue;
        const taken = r === live.prev && col === live.state;
        d.g.fillStyle = taken ? '#9fd8ff' : r === live.state ? '#4fb3ff' : '#3b7fb0';
        d.g.beginPath();
        d.g.arc(cx, cy, cell * 0.42 * Math.sqrt(w / max), 0, Math.PI * 2);
        d.g.fill();
      }
    }
  };
  return {
    el: c.el,
    update(m) {
      data = m.data as MarkovData;
      size = Math.round(m.params.size);
      key = '';
      requestAnimationFrame(draw);
    },
    tick(state) {
      const s = state as { state?: number; prev?: number } | undefined;
      live = { state: s?.state ?? -1, prev: s?.prev ?? -1 };
      draw();
    },
  };
}

export const TURING_ROWS = 8;

/**
 * A lit pad grid, like a grid controller: each column is a step of the loop,
 * lit at the row of its note in rainbow colours (low red, high violet). The
 * playing column glows; a flipped bit shows as a pad jumping rows.
 */
function turingFace(): Face {
  const el = h('div', { class: 'pad-grid face-visual', 'aria-hidden': 'true' });
  const pads: HTMLElement[][] = [];
  let cols = 0;
  let key = '';
  const build = (n: number) => {
    el.replaceChildren();
    pads.length = 0;
    el.style.setProperty('--cols', String(n));
    for (let r = 0; r < TURING_ROWS; r++) {
      const row: HTMLElement[] = [];
      for (let c = 0; c < n; c++) {
        const pad = h('span', {});
        // Row 0 is the top (highest note): violet down to red.
        pad.style.setProperty('--hue', String(Math.round(280 - (TURING_ROWS - 1 - r) * (280 / (TURING_ROWS - 1)))));
        row.push(pad);
        el.append(pad);
      }
      pads.push(row);
    }
    cols = n;
  };
  return {
    el,
    update(m) {
      const n = Math.round(m.params.length);
      if (n !== cols) build(n);
      key = '';
    },
    tick(state) {
      const s = state as { bits?: boolean[]; length?: number; pos?: number } | undefined;
      if (!s?.bits) return;
      const len = s.length ?? 8;
      if (len !== cols) build(len);
      const pos = Math.max(0, s.pos ?? 0);
      const k = s.bits.map(Number).join('') + len + ':' + pos;
      if (k === key) return;
      key = k;
      const loop = turingLoop(s.bits, len, pos);
      for (let c = 0; c < cols; c++) {
        const row = TURING_ROWS - 1 - Math.min(TURING_ROWS - 1, Math.floor(loop[c] * TURING_ROWS));
        for (let r = 0; r < TURING_ROWS; r++) {
          pads[r][c].classList.toggle('lit', r === row);
          pads[r][c].classList.toggle('now', c === pos);
        }
      }
    },
  };
}

const FLASH: Record<string, string> = { floor: '#ff8a3d', wall: '#e4d35a', ball: '#6fd1c4' };

/** The box with its balls; the edge flashes on a hit. */
function ballsFace(): Face {
  const c = liveCanvas('balls-face', 1.75);
  return {
    el: c.el,
    update() {},
    tick(state) {
      const s = state as { balls?: { x: number; y: number }[]; size?: number; flash?: string } | undefined;
      if (!s?.balls) return;
      const d = c.begin();
      if (!d) return;
      const { g, w, h: H } = d;
      g.strokeStyle = s.flash ? FLASH[s.flash] : '#33373e';
      g.lineWidth = s.flash ? 2 : 1;
      g.strokeRect(0.5, 0.5, w - 1, H - 1);
      s.balls.forEach((b, i) => {
        g.fillStyle = i === 0 ? '#ff8a3d' : '#e9e6df';
        g.beginPath();
        g.arc(b.x * w, b.y * H, Math.max(2, (s.size ?? 0.05) * H), 0, Math.PI * 2);
        g.fill();
      });
    },
  };
}

/** The live grid, with the scan column highlighted. */
function lifeFace(): Face {
  const c = liveCanvas('life-face', LIFE_COLS / LIFE_ROWS);
  let lastCells: number[] | null = null;
  let lastCol = -2;
  let lastW = 0;
  return {
    el: c.el,
    update() {},
    tick(state) {
      const s = state as { cells?: number[]; col?: number } | undefined;
      if (!s?.cells || (s.cells === lastCells && s.col === lastCol && c.el.clientWidth === lastW)) return;
      lastCells = s.cells;
      lastCol = s.col ?? -1;
      lastW = c.el.clientWidth;
      const d = c.begin();
      if (!d) return;
      const cw = d.w / LIFE_COLS;
      const ch = d.h / LIFE_ROWS;
      if (lastCol >= 0) {
        d.g.fillStyle = 'rgba(233, 230, 223, 0.12)';
        d.g.fillRect(lastCol * cw, 0, cw, d.h);
      }
      for (let r = 0; r < LIFE_ROWS; r++) {
        for (let col = 0; col < LIFE_COLS; col++) {
          if (!s.cells[r * LIFE_COLS + col]) continue;
          d.g.fillStyle = col === lastCol ? '#ff8a3d' : '#6fd1c4';
          d.g.fillRect(col * cw + 1, r * ch + 1, cw - 2, ch - 2);
        }
      }
    },
  };
}

/**
 * Concentric rings, outer ring first, like the Max and Reaktor Euclidean
 * sequencers: big coloured dots are hits, small grey dots rests, and a hand
 * in each ring's colour points at its current step.
 */
function euclidFace(): Face {
  const c = liveCanvas('euclid-face', 1);
  let params: Record<string, number> = {};
  let key = '';
  let steps: number[] = [];
  // Draw once the card is laid out, even before audio starts.
  const later = () => requestAnimationFrame(() => draw());
  const draw = () => {
      const k = steps.join(',') + c.el.clientWidth;
      if (k === key) return;
      key = k;
      const d = c.begin();
      if (!d) return;
      const { g, w } = d;
      const cx = w / 2;
      const cy = w / 2;
      const rings = Array.from({ length: EUCLID_RINGS }, (_, r) => ringSettings(params, r)).filter((s) => s.on);
      const outer = w / 2 - 8;
      const gap = outer / (EUCLID_RINGS + 0.6);
      g.strokeStyle = 'rgba(233, 230, 223, 0.08)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx, 4);
      g.lineTo(cx, w - 4);
      g.moveTo(4, cy);
      g.lineTo(w - 4, cy);
      g.stroke();
      Array.from({ length: EUCLID_RINGS }, (_, r) => r).forEach((r) => {
        const s = ringSettings(params, r);
        if (!s.on) return;
        const radius = outer - r * gap;
        const color = EUCLID_COLORS[r];
        const at = (i: number) => {
          const a = (i / s.steps) * Math.PI * 2 - Math.PI / 2;
          return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
        };
        g.strokeStyle = color + '55';
        g.beginPath();
        g.arc(cx, cy, radius, 0, Math.PI * 2);
        g.stroke();
        const pos = steps[r] ?? -1;
        if (pos >= 0) {
          const p = at(pos);
          g.strokeStyle = color;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(p.x, p.y);
          g.stroke();
          g.lineWidth = 1;
        }
        const dot = Math.max(2, Math.min(gap * 0.3, (Math.PI * radius) / s.steps * 0.6));
        for (let i = 0; i < s.steps; i++) {
          const p = at(i);
          const hit = euclidHit(i, s.hits, s.steps, s.rotate);
          g.fillStyle = hit ? color : '#5a5d63';
          g.beginPath();
          g.arc(p.x, p.y, hit ? dot : dot * 0.55, 0, Math.PI * 2);
          g.fill();
          if (i === pos && hit) {
            g.strokeStyle = '#ffffff';
            g.lineWidth = 2;
            g.beginPath();
            g.arc(p.x, p.y, dot + 2, 0, Math.PI * 2);
            g.stroke();
            g.lineWidth = 1;
          }
        }
      });
      if (!rings.length) return;
  };
  return {
    el: c.el,
    update(m) {
      params = m.params;
      key = '';
      later();
    },
    tick(state) {
      steps = (state as { steps?: number[] } | undefined)?.steps ?? [];
      draw();
    },
  };
}

function sequencerFace(): Face {
  const el = h('div', { class: 'seq-strip', 'aria-hidden': 'true' });
  const cells: HTMLElement[] = [];
  let lastStep = -1;
  return {
    el,
    update(m) {
      const data = m.data as SequencerData;
      const len = Math.round(m.params.length);
      while (cells.length < len) {
        const c = h('span', {});
        cells.push(c);
        el.append(c);
      }
      while (cells.length > len) cells.pop()!.remove();
      el.style.setProperty('--cols', String(Math.min(16, len)));
      cells.forEach((c, i) => {
        const s = data.steps[i];
        c.classList.toggle('on', s.on);
        c.style.setProperty('--chance', String(s.on ? 0.25 + s.chance * 0.75 : 0));
      });
      lastStep = -1;
    },
    tick(state) {
      const step = (state as { step?: number } | undefined)?.step ?? -1;
      if (step === lastStep) return;
      cells[lastStep]?.classList.remove('playing');
      cells[step]?.classList.add('playing');
      lastStep = step;
    },
  };
}
