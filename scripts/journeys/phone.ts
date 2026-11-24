/**
 * Every page on a phone (C8): at 390 by 844, as an iPhone shows it, each
 * page of the app opens without the page itself scrolling sideways (a
 * board's columns may scroll inside their own strip; the page may not).
 * `PHONE_SHOTS=<dir>` also saves a screenshot of each, to look at.
 */

import type { Page } from '../capture/cdp.ts';
import { WAIT_MS } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project } from './people.ts';

const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
/** A pixel of slack for rounding at a fractional scale. */
const SLACK = 1;

async function asPhone(page: Page) {
  await page.send('Emulation.setDeviceMetricsOverride', PHONE);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

/** How far the page itself overflows its width, in CSS pixels; 0 is none. */
const overflow = (page: Page) =>
  page.eval<number>(
    'Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)',
  );

export async function phoneJourney(checks: Checks, port: number) {
  process.stdout.write('Every page on a phone\n');
  let someone: Person | undefined;
  try {
    someone = await person(port, 'phone');
    const { page, workspaceId } = someone;
    const projectId = await project(someone, 'Pocket');
    const { issue } = await api<{ issue: { id: string } }>(
      page,
      `/workspaces/${workspaceId}/projects/${projectId}/issues`,
      'POST',
      { title: 'Readable on a phone, with a long title that has to wrap rather than spill' },
    );
    const { document } = await api<{ document: { id: string } }>(
      page,
      `/workspaces/${workspaceId}/documents`,
      'POST',
      { title: 'Pocket notes' },
    );
    await asPhone(page);

    const ws = `/workspaces/${workspaceId}`;
    const pages: [string, string][] = [
      ['home', '/workspaces'],
      ['board', `${ws}/projects/${projectId}`],
      ['issue', `${ws}/issues/${issue.id}`],
      ['document', `${ws}/documents/${document.id}`],
      ['feed', `${ws}/feed`],
      ['meetings', `${ws}/meetings`],
      ['calendar', `${ws}/calendar`],
      ['activity', `${ws}/activity`],
      ['insights', `${ws}/insights`],
      ['releases', `${ws}/releases`],
      ['automations', `${ws}/automations`],
      ['people', `${ws}/people`],
      ['import', `${ws}/projects/${projectId}/import`],
      ['search', `${ws}/search?q=pocket`],
      ['account', '/account'],
      ['first run', '/first-run'],
      ['guide', `/guide/create_issue?w=${workspaceId}`],
      ['landing', '/'],
    ];
    const shots = process.env.PHONE_SHOTS;
    for (const [name, path] of pages) {
      process.stdout.write(`  … ${name}\n`);
      await page.goto(`${WEB}${path}`);
      await page.waitFor(
        `document.readyState === 'complete' && !!document.querySelector('main, h1')`,
        WAIT_MS,
      );
      await Bun.sleep(600);
      const spill = await overflow(page);
      checks.check(`${name} fits a phone`, spill <= SLACK, `${spill}px wider than the screen`);
      if (shots) {
        const { data } = await page.send<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
        });
        await Bun.write(
          `${shots}/phone-${name.replace(/\s+/g, '-')}.png`,
          Buffer.from(data, 'base64'),
        );
      }
    }
  } finally {
    leave([someone]);
  }
}
