/**
 * Input for the browser tests: keys and text sent to the page as a person's
 * keyboard would send them (CDP Input.dispatchKeyEvent, Input.insertText),
 * and a wait that answers yes or no instead of throwing. Shared by the
 * keyboard test and the journeys (E1).
 */

import type { Page } from '../capture/cdp.ts';

/** Modifier bits, as CDP numbers them. */
export const CTRL = 2;
export const SHIFT = 8;

/** Long enough for a write to save locally, sync, and come back live. */
export const WAIT_MS = 15_000;

const NAMED: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Escape: { code: 'Escape', vk: 27 },
  Tab: { code: 'Tab', vk: 9 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ' ': { code: 'Space', vk: 32, text: ' ' },
  '?': { code: 'Slash', vk: 191, text: '?' },
  '/': { code: 'Slash', vk: 191, text: '/' },
};

/** Press one key: down then up, as a keyboard would. */
export async function press(page: Page, key: string, modifiers = 0) {
  const named = NAMED[key];
  const single = key.length === 1 && !named;
  const code = named?.code ?? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);
  const vk = named?.vk ?? key.toUpperCase().charCodeAt(0);
  const text = modifiers & CTRL ? undefined : (named?.text ?? (single ? key : undefined));
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: vk,
    ...(text ? { text, unmodifiedText: text } : {}),
  });
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    modifiers,
    windowsVirtualKeyCode: vk,
  });
  await Bun.sleep(200);
}

/** Type text where focus is, as an input method would. */
export async function typeText(page: Page, text: string) {
  await page.send('Input.insertText', { text });
  await Bun.sleep(300);
}

/** Give a field focus, as a click on it would; a script's click() does not. */
export async function focus(page: Page, selector: string) {
  const found = await page.eval<boolean>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  })()`);
  if (!found) throw new Error(`could not focus ${selector}`);
}

/** Whether `expression` holds within `ms`, polled; never throws for a timeout. */
export async function waitUntil(page: Page, expression: string, ms = WAIT_MS) {
  return page.waitFor(expression, ms).then(
    () => true,
    () => false,
  );
}
