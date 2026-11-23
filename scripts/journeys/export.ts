/**
 * A workspace export (C6), in Chrome: an owner asks for one on the People
 * page, sees it built in the background, downloads it once, and the zip
 * that lands holds the workspace's issues; the same link then gets nothing.
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip } from '@robis/storage';
import { WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project, statusOf } from './people.ts';

const buttonNamed = (label: string) =>
  `[...document.querySelectorAll('#exports button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;

/** The first finished download in `dir`, once Chrome has written it. */
async function downloaded(dir: string): Promise<string | null> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const done = readdirSync(dir).find((name) => name.endsWith('.zip'));
    if (done) return join(dir, done);
    await Bun.sleep(250);
  }
  return null;
}

export async function exportJourney(checks: Checks, port: number) {
  process.stdout.write('Workspace export\n');
  let owner: Person | undefined;
  const dir = mkdtempSync(join(tmpdir(), 'robis-export-'));
  try {
    owner = await person(port, 'export');
    const { page, workspaceId } = owner;
    const projectId = await project(owner, 'Exported');
    await api(page, `/workspaces/${workspaceId}/projects/${projectId}/issues`, 'POST', {
      title: 'Leaves in the zip',
    });
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

    await page.goto(`${WEB}/workspaces/${workspaceId}/people`);
    await page.waitFor(`!!${buttonNamed('Export everything')}`, WAIT_MS);
    await page.eval(`${buttonNamed('Export everything')}.click()`);
    checks.check(
      'an export is built in the background and offered once',
      await waitUntil(page, `!!${buttonNamed('Download')}`, WAIT_MS * 2),
    );

    // The link the button makes, read as the page would, then spent by Chrome.
    await page.eval(`${buttonNamed('Download')}.click()`);
    const file = await downloaded(dir);
    checks.check('the download lands as a zip', file !== null);
    if (file) {
      const entries = readZip(new Uint8Array(await Bun.file(file).arrayBuffer()), 50_000_000);
      const issues = entries.find((e) => e.name === 'issues.jsonl');
      checks.check(
        'holding the workspace’s issues',
        !!issues && new TextDecoder().decode(issues.data).includes('Leaves in the zip'),
      );
    }
    checks.check(
      'and is shown as downloaded, with no second download offered',
      await waitUntil(
        page,
        `document.querySelector('#exports')?.textContent.includes('Downloaded') && !${buttonNamed('Download')}`,
      ),
    );
    const { exports } = await api<{ exports: { id: string }[] }>(
      page,
      `/workspaces/${workspaceId}/exports`,
    );
    checks.check(
      'a new link cannot be made for it',
      (await statusOf(
        page,
        `/workspaces/${workspaceId}/exports/${exports[0]!.id}/link`,
        'POST',
        {},
      )) === 404,
    );
  } finally {
    leave([owner]);
    rmSync(dir, { recursive: true, force: true });
  }
}
