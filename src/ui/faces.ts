import { euclidHit } from '../modules/generative';
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
  if (m.type === 'euclid') return stripFace((m) => {
    const steps = Math.round(m.params.steps);
    return Array.from({ length: steps }, (_, i) => (euclidHit(i, Math.round(m.params.hits), steps, Math.round(m.params.rotate)) ? 1 : 0));
  }, (s) => (s as { step?: number })?.step ?? -1);
  if (m.type === 'markov') return stripFace((m) => {
    const d = m.data as MarkovData;
    return d.states.slice(0, Math.round(m.params.size)).map((st) => (st.mute ? 0 : 0.6));
  }, (s) => (s as { state?: number })?.state ?? -1);
  if (m.type === 'turing') return turingFace();
  if (m.type === 'random') return stripFace(() => [1, 1, 1, 1], (s) => (s as { pick?: number })?.pick ?? -1);
  if (m.type === 'balls') return ballsFace();
  if (m.type === 'life') return lifeFace();
  return null;
}

/** A row of cells with brightness from `levels` and the live one outlined. */
function stripFace(levels: (m: ModuleInstance) => number[], current: (state: unknown) => number): Face {
  const el = h('div', { class: 'seq-strip', 'aria-hidden': 'true' });
  const cells: HTMLElement[] = [];
  let last = -1;
  return {
    el,
    update(m) {
      const lv = levels(m);
      while (cells.length < lv.length) {
        const c = h('span', {});
        cells.push(c);
        el.append(c);
      }
      while (cells.length > lv.length) cells.pop()!.remove();
      el.style.setProperty('--cols', String(Math.min(16, lv.length)));
      cells.forEach((c, i) => {
        c.classList.toggle('on', lv[i] > 0);
        c.style.setProperty('--chance', String(lv[i]));
      });
      last = -1;
    },
    tick(state) {
      const i = current(state);
      if (i === last) return;
      cells[last]?.classList.remove('playing');
      cells[i]?.classList.add('playing');
      last = i;
    },
  };
}

/** The shift register's bits, lit when set; the loop length is the bright part. */
function turingFace(): Face {
  const el = h('div', { class: 'seq-strip', 'aria-hidden': 'true' });
  el.style.setProperty('--cols', '16');
  const cells = Array.from({ length: 16 }, () => el.appendChild(h('span', {})));
  let key = '';
  return {
    el,
    update() {},
    tick(state) {
      const s = state as { bits?: boolean[]; length?: number } | undefined;
      if (!s?.bits) return;
      const k = s.bits.map(Number).join('') + s.length;
      if (k === key) return;
      key = k;
      cells.forEach((c, i) => {
        c.classList.toggle('on', s.bits![i]);
        c.style.setProperty('--chance', i < (s.length ?? 16) ? '1' : '0.3');
      });
    },
  };
}

function canvasFace(cls: string, w: number, hgt: number) {
  const el = h('canvas', { class: `face-canvas ${cls}`, width: w * 2, height: hgt * 2, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const g = el.getContext('2d');
  g?.scale(2, 2);
  return { el, g };
}

const FLASH: Record<string, string> = { floor: '#ff8a3d', wall: '#e4d35a', ball: '#6fd1c4' };

/** The box with its balls; the edge flashes on a hit. */
function ballsFace(): Face {
  const W = 168;
  const H = 96;
  const { el, g } = canvasFace('balls-face', W, H);
  return {
    el,
    update() {},
    tick(state) {
      const s = state as { balls?: { x: number; y: number }[]; size?: number; flash?: string } | undefined;
      if (!g || !s?.balls) return;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = s.flash ? FLASH[s.flash] : '#33373e';
      g.lineWidth = s.flash ? 2 : 1;
      g.strokeRect(0.5, 0.5, W - 1, H - 1);
      s.balls.forEach((b, i) => {
        g.fillStyle = i === 0 ? '#ff8a3d' : '#e9e6df';
        g.beginPath();
        g.arc(b.x * W, b.y * H, Math.max(2, (s.size ?? 0.05) * H), 0, Math.PI * 2);
        g.fill();
      });
    },
  };
}

/** The live grid, with the scan column highlighted. */
function lifeFace(): Face {
  const C = 10;
  const W = LIFE_COLS * C;
  const H = LIFE_ROWS * C * 0.6;
  const { el, g } = canvasFace('life-face', W, H);
  let lastCells: number[] | null = null;
  let lastCol = -2;
  return {
    el,
    update() {},
    tick(state) {
      const s = state as { cells?: number[]; col?: number } | undefined;
      if (!g || !s?.cells || (s.cells === lastCells && s.col === lastCol)) return;
      lastCells = s.cells;
      lastCol = s.col ?? -1;
      const ch = H / LIFE_ROWS;
      g.clearRect(0, 0, W, H);
      if (lastCol >= 0) {
        g.fillStyle = 'rgba(233, 230, 223, 0.12)';
        g.fillRect(lastCol * C, 0, C, H);
      }
      for (let r = 0; r < LIFE_ROWS; r++) {
        for (let c = 0; c < LIFE_COLS; c++) {
          if (!s.cells[r * LIFE_COLS + c]) continue;
          g.fillStyle = c === lastCol ? '#ff8a3d' : '#6fd1c4';
          g.fillRect(c * C + 1, r * ch + 0.5, C - 2, ch - 1);
        }
      }
    },
  };
}

/** Mini step strip: lit steps are on, brightness is chance, the outline is the playhead. */
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
