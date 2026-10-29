import { EUCLID_COLORS, EUCLID_RINGS, euclidHit, ringSettings, turingLoop } from '../modules/generative';
import { LIFE_COLS, LIFE_ROWS } from '../modules/life';
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
  const el = h('div', { class: 'prob-bars', 'aria-hidden': 'true' });
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
  const el = h('div', { class: 'chance-lamps', 'aria-hidden': 'true' });
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
