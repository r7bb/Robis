/**
 * A very small Chrome DevTools Protocol client.
 *
 * Extracted from `screenshots.ts`, which had grown past the 800-line ceiling
 * the repo holds itself to. The split is also the natural seam: everything
 * here is about driving a browser, and nothing here knows what Relay is.
 *
 * Chrome over CDP rather than Playwright because Playwright's browser download
 * does not work on this machine, and Chrome is already installed. The subset
 * used is small: navigate, evaluate, emulate offline, capture.
 */
import { existsSync } from 'node:fs';

export type PageConfig = {
  /** Debugging port Chrome was launched with. */
  port: number;
  /** Directory screenshots are written to, with a trailing slash. */
  shotsDir: string;
  width: number;
  height: number;
  /** Device pixel ratio, so images stay sharp when scaled down. */
  scale: number;
};

export type Target = { id: string; type: string; url: string; webSocketDebuggerUrl: string };

/**
 * One browser tab.
 *
 * Every request carries a timeout. A dropped CDP response is otherwise
 * indistinguishable from a slow one, and the script hangs forever instead of
 * failing -- which is exactly what happened while this was being written.
 */
export class Page {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(
    private readonly socket: WebSocket,
    readonly targetId: string,
    private readonly config: PageConfig,
  ) {}

  static async attach(target: Target, config: PageConfig): Promise<Page> {
    const socket = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP socket did not open')), 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP socket failed'));
      });
    });

    const page = new Page(socket, target.id, config);

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const waiting = message.id !== undefined ? page.pending.get(message.id) : undefined;
      if (!waiting) return;

      page.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message ?? 'CDP error'));
      else waiting.resolve(message.result);
    });

    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: config.width,
      height: config.height,
      deviceScaleFactor: config.scale,
      mobile: false,
    });

    return page;
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }

    return result.result?.value as T;
  }

  async goto(url: string) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"');
    await Bun.sleep(700);
  }

  /** Poll a JavaScript predicate until it holds. */
  async waitFor(expression: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.eval<boolean>(`!!(${expression})`)) return;
      await Bun.sleep(150);
    }

    // Report what the page was actually showing. "Timed out" on its own sends
    // you back to re-run the whole capture just to find out where you were.
    const where = await this.eval<string>('location.href').catch(() => '<unreachable>');
    const body = await this.text().catch(() => '<no body>');

    throw new Error(
      `timed out waiting for: ${expression}\n  url: ${where}\n  body: ${body.slice(0, 400).replace(/\n+/g, ' | ')}`,
    );
  }

  /** Wait for text, tolerating the uppercase that CSS applies to headings. */
  waitForText(text: string, timeoutMs = 20_000) {
    return this.waitFor(
      `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
      timeoutMs,
    );
  }

  text(): Promise<string> {
    return this.eval<string>('document.body.innerText');
  }

  async click(selector: string) {
    const clicked = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

    if (!clicked) throw new Error(`nothing matched ${selector}`);
    await Bun.sleep(450);
  }

  /** Click the first element whose text contains `label`. */
  async clickText(selector: string, label: string) {
    const clicked = await this.eval<boolean>(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((n) => n.textContent.toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
      if (!el) return false;
      el.click();
      return true;
    })()`);

    if (!clicked) throw new Error(`no ${selector} containing "${label}"`);
    await Bun.sleep(450);
  }

  /**
   * Set a value on a React-controlled field.
   *
   * React tracks the previous value on the DOM node and ignores an event whose
   * value it believes it already has, so the native setter has to be called
   * rather than assigning `.value` directly.
   */
  async fill(selector: string, value: string) {
    const filled = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);

    if (!filled) throw new Error(`no field matched ${selector}`);
    await Bun.sleep(300);
  }

  /** Cut the network at the browser, which is what `navigator.onLine` reads. */
  setOffline(offline: boolean) {
    return this.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }

  async shot(name: string) {
    // Let any in-flight transition settle, so nothing is caught mid-fade.
    await Bun.sleep(400);
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await Bun.write(`${this.config.shotsDir}${name}`, Buffer.from(data, 'base64'));
    console.log(`  ${name}`);
  }

  close() {
    this.socket.close();
  }
}

/** Where a Chrome or Chromium binary usually lives, by platform. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findChrome(): string {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No Chrome found. Looked in:\n${CHROME_CANDIDATES.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  return found;
}

export async function listTargets(port: number): Promise<Target[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  return (await response.json()) as Target[];
}

/** Open a second tab, for the screenshots that need two windows. */
export async function openTab(config: PageConfig, url: string): Promise<Page> {
  const response = await fetch(
    `http://127.0.0.1:${config.port}/json/new?${encodeURIComponent(url)}`,
    {
      method: 'PUT',
    },
  );
  const target = (await response.json()) as Target;

  // The freshly created target is not always in /json immediately.
  for (let i = 0; i < 40; i++) {
    const match = (await listTargets(config.port)).find((t) => t.id === target.id);
    if (match?.webSocketDebuggerUrl) return Page.attach(match, config);
    await Bun.sleep(150);
  }

  throw new Error('new tab never appeared');
}

/**
 * Close a tab by its target id.
 *
 * Not by url: both tabs sit on the same origin, so matching on a prefix can
 * close the main one and leave the rest of the run driving a dead page.
 */
export async function closeTab(config: PageConfig, page: Page) {
  const id = page.targetId;
  page.close();
  await fetch(`http://127.0.0.1:${config.port}/json/close/${id}`);
  await Bun.sleep(300);
}
