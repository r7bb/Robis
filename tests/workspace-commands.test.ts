import { describe, expect, test } from 'bun:test';
import { boardHref, channelHref } from '@robis/web/lib/links.ts';
import {
  HITS_PER_KIND,
  type WorkspaceSources,
  workspaceCommands,
} from '@robis/web/lib/workspace-commands.ts';

/** What the palette offers on any workspace page (C2), and where each leads. */

const WS = 'ws-1';
const release = { id: 'p-rel', key: 'REL', name: 'Release', archived: false };
const web = { id: 'p-web', key: 'WEB', name: 'Website', archived: false };
const old = { id: 'p-old', key: 'OLD', name: 'Old', archived: true };
const zoe = { userId: 'u-zoe', name: 'Zoë Hartmann', kind: 'human' as const };
const bot = { userId: 'u-bot', name: 'Triage bot', kind: 'agent' as const };

function sources(extra: Partial<WorkspaceSources> = {}) {
  const visited: string[] = [];
  const s: WorkspaceSources = {
    workspaceId: WS,
    projects: [release, web, old],
    channels: [{ id: 'c-gen', name: 'general' }],
    people: [zoe, bot],
    hits: [],
    query: '',
    currentProjectId: null,
    pageFilesIssues: false,
    go: (href) => visited.push(href),
    ...extra,
  };
  return { s, visited };
}

const byId = (list: { id: string }[], id: string) => {
  const found = list.find((c) => c.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found as ReturnType<typeof workspaceCommands>['local'][number];
};

describe('the links', () => {
  test('a board, filtered and ready to file an issue', () => {
    expect(boardHref(WS, 'p')).toBe('/workspaces/ws-1/projects/p');
    expect(boardHref(WS, 'p', { compose: true })).toBe('/workspaces/ws-1/projects/p?new=1');
    expect(boardHref(WS, 'p', { filter: { assigneeId: 'u' } })).toBe(
      '/workspaces/ws-1/projects/p?assignee=u',
    );
  });

  test('a channel', () => {
    expect(channelHref(WS, 'c 1')).toBe('/workspaces/ws-1?channel=c%201');
  });
});

describe('boards and new issues', () => {
  test('every open board, none archived', () => {
    const { local } = workspaceCommands(sources().s);
    expect(local.filter((c) => c.group === 'Boards').map((c) => c.title)).toEqual([
      'Release board',
      'Website board',
    ]);
  });

  test('a board opens', () => {
    const { s, visited } = sources();
    byId(workspaceCommands(s).local, 'board:p-rel').run?.();
    expect(visited).toEqual(['/workspaces/ws-1/projects/p-rel']);
  });

  test('new issue asks which board, and opens it ready to type', () => {
    const { s, visited } = sources();
    const command = byId(workspaceCommands(s).local, 'new-issue');
    expect(command.action).toBe('newIssue');
    expect(command.children?.map((c) => c.title)).toEqual([
      'New issue in Release',
      'New issue in Website',
    ]);
    command.children?.[1]?.run?.();
    expect(visited).toEqual(['/workspaces/ws-1/projects/p-web?new=1']);
  });

  test('with one board, new issue needs no choice', () => {
    const { s } = sources({ projects: [release] });
    const command = byId(workspaceCommands(s).local, 'new-issue');
    expect(command.title).toBe('New issue in Release');
    expect(command.children).toBeUndefined();
  });

  test('not when the page already offers its own', () => {
    const { local } = workspaceCommands(sources({ pageFilesIssues: true }).s);
    expect(local.some((c) => c.id === 'new-issue')).toBe(false);
  });
});

describe('channels and people', () => {
  test('a channel opens on the workspace page', () => {
    const { s, visited } = sources();
    byId(workspaceCommands(s).local, 'channel:c-gen').run?.();
    expect(visited).toEqual(['/workspaces/ws-1?channel=c-gen']);
  });

  test('on a board, a person shows their issues on it', () => {
    const { s, visited } = sources({ currentProjectId: 'p-web' });
    byId(workspaceCommands(s).local, 'person:u-zoe').run?.();
    expect(visited).toEqual(['/workspaces/ws-1/projects/p-web?assignee=u-zoe']);
  });

  test('elsewhere, a choice of boards', () => {
    const { s } = sources();
    const zoeCommand = byId(workspaceCommands(s).local, 'person:u-zoe');
    expect(zoeCommand.run).toBeUndefined();
    expect(zoeCommand.children?.map((c) => c.title)).toEqual([
      'Zoë Hartmann’s issues on Release',
      'Zoë Hartmann’s issues on Website',
    ]);
  });

  test('an agent says so', () => {
    expect(byId(workspaceCommands(sources().s).local, 'person:u-bot').hint).toBe('Agent');
  });

  test('with no open board, nobody: there is nowhere to show their issues', () => {
    const { local } = workspaceCommands(sources({ projects: [old] }).s);
    expect(local.filter((c) => c.group === 'People')).toEqual([]);
  });
});

describe('what search found', () => {
  const hit = (kind: 'issue' | 'document' | 'comment', n: number) => ({
    kind,
    id: `${kind}-${n}`,
    title: `${kind} ${n}`,
    issueId: kind === 'document' ? null : `issue-${n}`,
  });

  test('nothing until something is typed', () => {
    expect(workspaceCommands(sources({ hits: [hit('issue', 1)] }).s).found).toEqual([]);
  });

  test('issues and documents, a few of each, comments left out, then all results', () => {
    const hits = [
      ...Array.from({ length: 7 }, (_, n) => hit('issue', n)),
      hit('comment', 1),
      hit('document', 1),
    ];
    const { found } = workspaceCommands(sources({ hits, query: 'deploy ' }).s);
    expect(found.filter((c) => c.group === 'Issues')).toHaveLength(HITS_PER_KIND);
    expect(found.filter((c) => c.group === 'Documents').map((c) => c.id)).toEqual([
      'document:document-1',
    ]);
    expect(found.some((c) => c.id.startsWith('comment'))).toBe(false);
    expect(found.at(-1)?.title).toBe('All results for “deploy”');
  });

  test('each opens its page', () => {
    const { s, visited } = sources({ hits: [hit('issue', 1), hit('document', 2)], query: 'x' });
    for (const command of workspaceCommands(s).found) command.run?.();
    expect(visited).toEqual([
      '/workspaces/ws-1/issues/issue-1',
      '/workspaces/ws-1/documents/document-2',
      '/workspaces/ws-1/search?q=x',
    ]);
  });
});
