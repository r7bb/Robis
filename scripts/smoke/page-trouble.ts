/**
 * What a page was doing when it did not hydrate (stage 4 follow-up).
 *
 * The browser smoke test has failed "/: hydrated" about one CI run in five,
 * only over HTTPS and only on the first page a fresh Chrome loads, and it
 * could not be reproduced locally even with the processor slowed twenty
 * times. A bare "NOT hydrated" says nothing about why, so a failing check
 * now carries what the page threw, which requests failed, which were still
 * open, and which took longest.
 */
import type { Page } from '../capture/cdp.ts';

type Exception = { exceptionDetails: { text: string; exception?: { description?: string } } };
type Sent = { requestId: string; request: { url: string } };
type Done = { requestId: string };
type Failed = {
  requestId: string;
  errorText: string;
  canceled?: boolean;
  blockedReason?: string;
};

/** The last part of a URL's path, enough to tell the requests apart. */
const tail = (url: string) => url.replace(/^https?:\/\/[^/]+/, '').slice(-60);

export class PageTrouble {
  private readonly open = new Map<string, string>();
  private readonly seen: string[] = [];

  constructor(page: Page) {
    page.on<Exception>('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      this.seen.push(
        `threw ${(exceptionDetails.exception?.description ?? exceptionDetails.text).split('\n')[0]}`,
      );
    });
    page.on<Sent>('Network.requestWillBeSent', ({ requestId, request }) => {
      this.open.set(requestId, request.url);
    });
    page.on<Done>('Network.loadingFinished', ({ requestId }) => this.open.delete(requestId));
    page.on<Failed>(
      'Network.loadingFailed',
      ({ requestId, errorText, canceled, blockedReason }) => {
        const url = this.open.get(requestId) ?? requestId;
        this.open.delete(requestId);
        if (!canceled) this.seen.push(`failed ${tail(url)} (${errorText || blockedReason})`);
      },
    );
  }

  /** Start a fresh record for the next page. */
  reset() {
    this.open.clear();
    this.seen.length = 0;
  }

  /** One line: the page's state, then everything recorded since `reset`. */
  async describe(page: Page): Promise<string> {
    const state = await page
      .eval<string>(
        `JSON.stringify({
          url: location.pathname,
          readyState: document.readyState,
          scripts: document.scripts.length,
          slowest: performance.getEntriesByType('resource')
            .sort((a, b) => b.duration - a.duration).slice(0, 3)
            .map((e) => e.name.replace(/^https?:\\/\\/[^/]+/, '').slice(-60) + ' ' + Math.round(e.duration) + 'ms ' + e.nextHopProtocol),
        })`,
      )
      .catch((error: unknown) => `unreadable: ${String(error)}`);
    const open = [...this.open.values()].map((url) => `open ${tail(url)}`);
    return [state, ...this.seen, ...open].join(' | ');
  }
}
