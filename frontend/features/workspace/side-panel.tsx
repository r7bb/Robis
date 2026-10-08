'use client';

import type { Role } from '@robis/shared';
import { type KeyboardEvent, useRef, useState } from 'react';
import { ActivityFeed } from '../../components/activity-feed.tsx';
import { MemberList } from '../../components/member-list.tsx';
import type { Member } from '../../lib/api.ts';
import { MeetingsPanel } from '../meetings/meetings-panel.tsx';
import { DocumentsPanel, ProjectsPanel } from './panels.tsx';

/**
 * The right rail.
 *
 * Everything that is *about* the workspace rather than part of the
 * conversation lives here, one pane at a time. Tabs rather than a long
 * scrolling column because these are alternatives -- nobody reads the
 * meeting list and the audit trail at once -- and a column that stacks them
 * all buries whichever is at the bottom.
 */

const TABS = ['Projects', 'Docs', 'Meetings', 'Team', 'Activity'] as const;
type Tab = (typeof TABS)[number];

export function SidePanel({
  workspaceId,
  role,
  members,
  currentUserId,
}: {
  workspaceId: string;
  role: Role;
  members: Member[];
  currentUserId: string | null;
}) {
  const [active, setActive] = useState<Tab>('Projects');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /*
   * Arrow keys move between tabs, which is what the tablist pattern requires
   * and what a keyboard user will try. Without this each tab is a separate
   * tab stop, so reaching the last one in a five-tab strip takes five
   * presses and leaves the panel behind.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;

    event.preventDefault();

    const index = TABS.indexOf(active);
    // Wraps, so the ends of the strip are not dead stops.
    const next = (index + delta + TABS.length) % TABS.length;

    setActive(TABS[next]!);
    tabRefs.current[next]?.focus();
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-raised">
      <div
        role="tablist"
        aria-label="Workspace panels"
        onKeyDown={onKeyDown}
        className="flex gap-px overflow-x-auto border-b border-line px-2 pt-2"
      >
        {TABS.map((tab, index) => {
          const selected = tab === active;

          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`panel-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`panel-${tab}`}
              // Only the active tab is in the tab order; the arrow keys reach
              // the rest. This is the roving-tabindex half of the pattern.
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab)}
              className={`whitespace-nowrap rounded-t-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                selected ? 'bg-surface text-content' : 'text-faint hover:text-muted'
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/*
       * Only the selected pane is mounted. Rendering all five and hiding four
       * would run five sets of queries and five polling timers for one
       * visible panel.
       */}
      {/*
        The tabpanel is deliberately focusable. After arrowing to a tab, the
        next Tab press should land inside its panel; a panel whose first
        child is plain text has nothing to receive that focus, so the
        container takes it. This is what the ARIA authoring practices
        prescribe, and Biome's rule does not model the tabs pattern.
      */}
      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`panel-tab-${active}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: required by the tabs pattern
        tabIndex={0}
        className="flex-1 overflow-y-auto bg-surface p-3"
      >
        {active === 'Projects' ? <ProjectsPanel workspaceId={workspaceId} role={role} /> : null}
        {active === 'Docs' ? <DocumentsPanel workspaceId={workspaceId} role={role} /> : null}

        {active === 'Meetings' ? (
          <MeetingsPanel
            workspaceId={workspaceId}
            role={role}
            members={members}
            currentUserId={currentUserId}
          />
        ) : null}

        {active === 'Team' ? <MemberList workspaceId={workspaceId} viewerRole={role} /> : null}
        {active === 'Activity' ? <ActivityFeed workspaceId={workspaceId} /> : null}
      </div>
    </aside>
  );
}
