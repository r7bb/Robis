import type { Command } from './commands.ts';
import { boardHref, channelHref } from './links.ts';
import { hitHref, searchHref } from './search-links.ts';

/**
 * The commands every workspace page has (C2), built from what the palette
 * has fetched: its boards, channels and people, and what search found.
 * Pages add their own beside these (see `useCommands`).
 */

type Project = { id: string; key: string; name: string; archived: boolean };
type Channel = { id: string; name: string };
type Person = { userId: string; name: string; kind: 'human' | 'agent' };
type Hit = {
  kind: 'issue' | 'document' | 'comment';
  id: string;
  title: string;
  issueId: string | null;
};

export type WorkspaceSources = {
  workspaceId: string;
  projects: readonly Project[];
  channels: readonly Channel[];
  people: readonly Person[];
  /** Search results for what was typed, best first. */
  hits: readonly Hit[];
  query: string;
  /** The board on screen, if any: where a person's issues are shown first. */
  currentProjectId: string | null;
  /** Whether the page on screen already offers its own New issue. */
  pageFilesIssues: boolean;
  go: (href: string) => void;
};

/** How many search results of each kind the palette lists. */
export const HITS_PER_KIND = 5;

function newIssueCommand(s: WorkspaceSources, open: readonly Project[]): Command[] {
  if (s.pageFilesIssues || open.length === 0) return [];
  const file = (project: Project) => () =>
    s.go(boardHref(s.workspaceId, project.id, { compose: true }));
  const only = open.length === 1 ? open[0] : undefined;
  if (only) {
    return [
      {
        id: 'new-issue',
        title: `New issue in ${only.name}`,
        group: 'Actions',
        action: 'newIssue',
        run: file(only),
      },
    ];
  }
  return [
    {
      id: 'new-issue',
      title: 'New issue in…',
      group: 'Actions',
      action: 'newIssue',
      flatten: true,
      children: open.map((project) => ({
        id: `new-issue:${project.id}`,
        title: `New issue in ${project.name}`,
        group: 'Actions',
        action: 'newIssue',
        keywords: [project.key],
        run: file(project),
      })),
    },
  ];
}

/**
 * A person leads to the issues assigned to them: on the board on screen, or
 * the only board, or else a choice of boards.
 */
function personCommand(s: WorkspaceSources, open: readonly Project[], person: Person): Command {
  const theirs = (project: Project) => () =>
    s.go(boardHref(s.workspaceId, project.id, { filter: { assigneeId: person.userId } }));
  const base = {
    id: `person:${person.userId}`,
    title: person.name,
    group: 'People' as const,
    hint: person.kind === 'agent' ? 'Agent' : undefined,
    keywords: ['assigned', 'issues'],
  };
  const here =
    open.find((p) => p.id === s.currentProjectId) ?? (open.length === 1 ? open[0] : undefined);
  if (here) return { ...base, run: theirs(here) };
  return {
    ...base,
    children: open.map((project) => ({
      id: `person:${person.userId}:${project.id}`,
      title: `${person.name}’s issues on ${project.name}`,
      group: 'Boards',
      run: theirs(project),
    })),
  };
}

function hitCommands(s: WorkspaceSources): Command[] {
  const of = (kind: 'issue' | 'document', group: 'Issues' | 'Documents') =>
    s.hits
      .filter((hit) => hit.kind === kind)
      .slice(0, HITS_PER_KIND)
      .map<Command>((hit) => ({
        id: `${kind}:${hit.id}`,
        title: hit.title,
        group,
        run: () => s.go(hitHref(s.workspaceId, hit)),
      }));
  return [...of('issue', 'Issues'), ...of('document', 'Documents')];
}

/** Every command not tied to one page. Search results are listed as found. */
export function workspaceCommands(s: WorkspaceSources): { local: Command[]; found: Command[] } {
  const open = s.projects.filter((project) => !project.archived);
  const local: Command[] = [
    ...newIssueCommand(s, open),
    ...open.map<Command>((project) => ({
      id: `board:${project.id}`,
      title: `${project.name} board`,
      group: 'Boards',
      action: 'openBoard',
      keywords: [project.key, 'go to'],
      hint: project.key,
      run: () => s.go(boardHref(s.workspaceId, project.id)),
    })),
    ...s.channels.map<Command>((channel) => ({
      id: `channel:${channel.id}`,
      title: `#${channel.name}`,
      group: 'Channels',
      keywords: ['channel', 'chat'],
      run: () => s.go(channelHref(s.workspaceId, channel.id)),
    })),
    // With no board there is nowhere to show a person's issues.
    ...(open.length > 0 ? s.people.map((person) => personCommand(s, open, person)) : []),
  ];
  const found = s.query.trim()
    ? [
        ...hitCommands(s),
        {
          id: 'search-all',
          title: `All results for “${s.query.trim()}”`,
          group: 'Search' as const,
          run: () => s.go(searchHref(s.workspaceId, s.query)),
        },
      ]
    : [];
  return { local, found };
}
