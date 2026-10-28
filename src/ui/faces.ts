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
  return null;
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
