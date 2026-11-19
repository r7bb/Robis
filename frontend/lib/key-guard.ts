/**
 * Whether a single-key shortcut (the board's, focus mode's) should leave a
 * key alone: someone is typing, a dialog is up, or something already used it.
 */

const NOT_TYPING = new Set(['checkbox', 'radio', 'button', 'submit', 'reset']);

/**
 * Somewhere a key is text, or picks an option, rather than a shortcut.
 * Escape still reaches the board from a select, which has no use for it.
 */
function isTyping(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLSelectElement && key === 'Escape') return false;
  if (target instanceof HTMLInputElement) return !NOT_TYPING.has(target.type);
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/** A dialog is up (the palette, a confirmation, the help): its keys are its own. */
function modalOpen(): boolean {
  return document.querySelector('dialog[open], [aria-modal="true"]') !== null;
}

/** A key the page, a field or a dialog already has a use for. */
export function busyElsewhere(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented || event.isComposing || isTyping(event.target, event.key) || modalOpen()
  );
}
