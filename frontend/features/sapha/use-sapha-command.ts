'use client';

import { describeIntent, interpret, LOOKING_INTENTS, type SaphaIntent } from '@robis/shared';
import { useRouter } from 'next/navigation';
import type { Command } from '../../lib/commands.ts';
import type { Action } from '../../lib/permissions.ts';
import { searchHref } from '../../lib/search-links.ts';
import { placeOf } from './run-intent.ts';

/** A change Sapha read, shown in the palette to be confirmed. */
export type Proposal = Exclude<SaphaIntent, { kind: 'open' | 'search' | 'go' }>;

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
 * The palette's Sapha row (tier 0): when what was typed reads as a request,
 * one command saying what it will do. Looking goes at once; a change opens
 * Sapha's card (`propose`) and waits for a yes. Nothing is sent anywhere to
 * be read: the request is understood here, in the browser.
 */
export function useSaphaCommand(
  workspaceId: string,
  query: string,
  propose: (intent: Proposal) => void,
): Command[] {
  const router = useRouter();
  const intent = interpret(query);
  if (!intent) return [];
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
