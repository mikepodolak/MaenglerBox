import type { AppStore } from '../app/store';
import { HELP, PATCHING_TIP } from '../modules/help';
import { getDef } from '../modules/registry';
import { modParam } from '../patch/model';
import { fullParamLabel } from '../patch/params';
import { applyRecipe } from '../patch/recipes';
import { h } from './dom';
import { closeAllSheets, openSheet } from './sheet';

/** Where recipe modules should land; the app points this at the canvas. */
let placer: () => { x: number; y: number } = () => ({ x: 40, y: 40 });

export function setHelpPlacer(fn: () => { x: number; y: number }): void {
  placer = fn;
}

/**
 * The help sheet for a module type: how it works, what each jack carries,
 * what the main settings do, and patches to try, some addable in one tap.
 */
export function openHelp(store: AppStore, type: string): void {
  const def = getDef(type);
  if (!def) return;
  const help = HELP[type] ?? { about: def.description ?? '' };
  const portLabel = (id: string, side: 'inputs' | 'outputs') => def[side].find((p) => p.id === id)?.label ?? id;
  const paramLabel = (id: string) => def.params.find((p) => p.id === id)?.label ?? id;
  const kindOf = (id: string, side: 'inputs' | 'outputs') => def[side].find((p) => p.id === id)?.kind ?? 'gate';

  const list = (title: string, entries: Record<string, string> | undefined, label: (id: string) => string, kind?: (id: string) => string) =>
    entries && Object.keys(entries).length
      ? h(
          'section',
          { class: 'help-section' },
          h('h3', {}, title),
          h(
            'dl',
            {},
            ...Object.entries(entries).flatMap(([id, text]) => [
              h('dt', {}, kind ? h('span', { class: `jack-dot ${kind(id)}` }) : null, label(id)),
              h('dd', {}, text),
            ]),
          ),
        )
      : null;

  const ideas = help.ideas?.length
    ? h(
        'section',
        { class: 'help-section' },
        h('h3', {}, 'Try this'),
        ...help.ideas.map((idea) =>
          h(
            'div',
            { class: 'help-idea' },
            h('strong', {}, idea.title),
            h('p', {}, idea.text),
            idea.recipe
              ? h(
                  'div',
                  { class: 'help-recipe' },
                  h('code', {}, idea.recipe.cables.filter((c) => !c.includes('out.right')).map(prettyCable(idea.recipe.modules)).join('\n')),
                  h('button', {
                    onclick: () => {
                      let self: string | null = null;
                      store.update((p) => {
                        const r = applyRecipe(p, getDef, idea.recipe!, placer());
                        self = r.selfId;
                        return r.patch;
                      });
                      closeAllSheets();
                      if (self) store.select(self);
                    },
                  }, 'Add to patch'),
                )
              : null,
          ),
        ),
      )
    : null;

  openSheet(
    def.label,
    'help',
    h('p', { class: 'help-about' }, help.about),
    list('Inputs', help.inputs, (id) => portLabel(id, 'inputs'), (id) => kindOf(id, 'inputs')),
    list('Outputs', help.outputs, (id) => portLabel(id, 'outputs'), (id) => kindOf(id, 'outputs')),
    list('Settings', help.settings, paramLabel),
    ideas,
    h('details', { class: 'help-section help-cables' }, h('summary', {}, 'About cables'), h('p', {}, PATCHING_TIP)),
  );
}

/** 'clock.out > self.clock' → 'Clock Out → Euclidean Clock'. */
function prettyCable(modules: Record<string, { type: string }>) {
  return (c: string) => {
    const [from, to] = c.split('>').map((s) => s.trim().split('.'));
    const name = (key: string, port: string, side: 'inputs' | 'outputs') => {
      const def = getDef(modules[key]?.type ?? '');
      const param = side === 'inputs' ? modParam(port) : null;
      const label = param !== null ? `~ ${def ? fullParamLabel(def, param) : param}` : (def?.[side].find((p) => p.id === port)?.label ?? port);
      return `${def?.label ?? key} ${label}`;
    };
    return `${name(from[0], from[1], 'outputs')} → ${name(to[0], to[1], 'inputs')}`;
  };
}
