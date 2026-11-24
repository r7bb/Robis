/**
 * Importing issues (C6), in Chrome: a CSV file chosen on a board's import
 * page lands as issues, and choosing it again adds nothing.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '../capture/cdp.ts';
import { WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project } from './people.ts';

/** Choose `path` in the file input `selector`, as a person picking a file would. */
async function chooseFile(page: Page, selector: string, path: string) {
  const { root } = await page.send<{ root: { nodeId: number } }>('DOM.getDocument', {});
  const { nodeId } = await page.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: root.nodeId,
    selector,
  });
  await page.send('DOM.setFileInputFiles', { nodeId, files: [path] });
}

const status = `document.querySelector('#import-csv')?.closest('section')?.querySelector('[role="status"]')?.textContent ?? ''`;
const importButton = `[...document.querySelector('#import-csv').closest('section').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Import')`;

export async function importJourney(checks: Checks, port: number) {
  process.stdout.write('Import issues\n');
  let owner: Person | undefined;
  const dir = mkdtempSync(join(tmpdir(), 'robis-import-'));
  try {
    owner = await person(port, 'import');
    const { page, workspaceId } = owner;
    const projectId = await project(owner, 'Imported');
    const csv = join(dir, 'issues.csv');
    await Bun.write(
      csv,
      'Title,Status,Labels\nPlan the launch,in progress,launch\nBook a room,done,\n',
    );

    await page.goto(`${WEB}/workspaces/${workspaceId}/projects/${projectId}/import`);
    await page.waitFor(`!!document.querySelector('#import-csv')`, WAIT_MS);
    await chooseFile(page, '#import-csv', csv);
    await page.eval(`${importButton}.click()`);
    checks.check(
      'a chosen CSV lands as issues',
      await waitUntil(page, `${status}.includes('2 of 2 issues added')`),
    );
    await page.eval(`${importButton}.click()`);
    checks.check(
      'and choosing it again adds nothing',
      await waitUntil(page, `${status}.includes('0 of 2 issues added, 2 already here')`),
    );
    const { issues } = await api<{ issues: { title: string; status: string }[] }>(
      page,
      `/workspaces/${workspaceId}/projects/${projectId}/issues`,
    );
    checks.check(
      'with their statuses mapped',
      issues.length === 2 &&
        issues.some((i) => i.title === 'Plan the launch' && i.status === 'IN_PROGRESS'),
    );
  } finally {
    leave([owner]);
    rmSync(dir, { recursive: true, force: true });
  }
}
