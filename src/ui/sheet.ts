import { h } from './dom';

/** Close every open sheet, e.g. the module menu under a help sheet once a recipe is added. */
export function closeAllSheets(): void {
  document.querySelectorAll<HTMLDialogElement>('dialog.sheet').forEach((d) => {
    d.close();
    d.remove();
  });
}

/**
 * A modal sheet with a title bar and a close button. Tapping outside it,
 * pressing Escape or tapping × closes it, so long lists never need a
 * scroll to the bottom to dismiss.
 */
export function openSheet(title: string, cls: string, ...content: (Node | null)[]): { dialog: HTMLDialogElement; close: () => void } {
  const dialog = h('dialog', { class: `sheet ${cls}` });
  const close = () => {
    if (!dialog.isConnected) return;
    dialog.close();
    dialog.remove();
  };
  dialog.append(
    h('header', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon', 'aria-label': 'Close', onclick: close }, '×')),
    ...content.filter((c): c is Node => c !== null),
  );
  // A tap on the dimmed backdrop lands on the dialog itself, outside its box.
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) close();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}
