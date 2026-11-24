'use client';

import { describeIntent, interpret, LOOKING_INTENTS, type SaphaIntent } from '@robis/shared';
import { useRouter } from 'next/navigation';
import type { Command } from '../../lib/commands.ts';
import type { Action } from '../../lib/permissions.ts';
import { searchHref } from '../../lib/search-links.ts';
import { useAssist } from '../assist/use-assist.ts';
import { placeOf } from './run-intent.ts';

/** Shorter than this, a request is more likely a search than something to do. */
const ASK_FROM = 8;

/** A change Sapha read, shown in the palette to be confirmed. */
export type Proposal = Exclude<SaphaIntent, { kind: 'open' | 'search' | 'go' | 'blockers' }>;

/** What a role must be allowed to do for Sapha to offer the change. */
function actionFor(intent: SaphaIntent): Action | undefined {
  switch (intent.kind) {
    case 'status':
    case 'priority':
    case 'due':
    case 'assign':
    case 'unassign':
      return 'editIssue';
    case 'create':
      return 'newIssue';
    default:
      return undefined;
  }
}

/**
 * The palette's Sapha row. Tier 0: when what was typed reads as a request,
 * one command saying what it will do, understood here in the browser.
 * Looking goes at once; a change opens Sapha's card (`propose`) and waits
 * for a yes. Tier 1: when it does not read, and the workspace has turned
 * assistance on, Ask Sapha sends only the words typed to be read (`ask`).
 */
export function useSaphaCommand(
  workspaceId: string,
  query: string,
  propose: (intent: Proposal) => void,
  ask: (request: string) => void,
  /** A question to answer in the palette: what an issue waits on. */
  answer: (issueKey: string) => void,
): Command[] {
  const router = useRouter();
  const { available } = useAssist(workspaceId);
  const intent = interpret(query);
  const typed = query.trim();
  if (!intent) {
    if (!available || typed.length < ASK_FROM) return [];
    return [
      {
        id: 'sapha-ask',
        title: `Ask Sapha: “${typed}”`,
        group: 'Sapha',
        hint: 'Uses the assistant',
        keepOpen: true,
        run: () => ask(typed),
      },
    ];
  }
  if (intent.kind === 'blockers') {
    return [
      {
        id: 'sapha',
        title: describeIntent(intent),
        group: 'Sapha',
        hint: 'Answers here',
        keepOpen: true,
        run: () => answer(intent.issueKey),
      },
    ];
  }
  const looking = LOOKING_INTENTS.has(intent.kind);
  return [
    {
      id: 'sapha',
      title: describeIntent(intent),
      group: 'Sapha',
      hint: looking ? 'Go' : 'Asks first',
      action: actionFor(intent),
      keepOpen: !looking,
      run: looking
        ? () => {
            void placeOf(workspaceId, intent as Exclude<SaphaIntent, Proposal>)
              .then((href) => router.push(href))
              // An issue key not found here: search for it instead.
              .catch(() => router.push(searchHref(workspaceId, query)));
          }
        : () => propose(intent as Proposal),
    },
  ];
}
