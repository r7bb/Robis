'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../../components/ui/avatar.tsx';
import { AgentBadge } from '../../components/ui/primitives.tsx';
import type { Member } from '../../lib/api.ts';

/** How many faces show before the rest are a count. */
const FACES = 3;

/**
 * Who is in the workspace, at the top of the chat where you talk to them:
 * the faces of those here now, and a count that opens everyone, with a way
 * to the people page for invitations and roles. The one place the team is
 * listed.
 */
export function PeopleStack({
  workspaceId,
  members,
  onlineIds,
}: {
  workspaceId: string;
  members: Member[];
  onlineIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    // Caught on the way down, so a panel this sits in does not close too.
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Here now first, then everyone else, each by name.
  const ordered = [...members].sort(
    (a, b) =>
      Number(onlineIds.has(b.userId)) - Number(onlineIds.has(a.userId)) ||
      a.name.localeCompare(b.name),
  );
  const here = ordered.filter((member) => onlineIds.has(member.userId));
  const faces = (here.length > 0 ? here : ordered).slice(0, FACES);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${members.length} ${members.length === 1 ? 'person' : 'people'}, ${here.length} here now`}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span className="flex -space-x-1.5">
          {faces.map((member) => (
            <span key={member.userId} className="flex shrink-0 rounded-full ring-2 ring-raised">
              <Avatar name={member.name} seed={member.userId} avatar={member.avatar} size="sm" />
            </span>
          ))}
        </span>
        <span className="tabular-nums">{members.length}</span>
      </button>

      {open && (
        <div
          id={listId}
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-line bg-raised p-1.5 shadow-lg shadow-black/20"
        >
          <ul className="max-h-72 space-y-px overflow-y-auto overscroll-contain">
            {ordered.map((member) => {
              const online = onlineIds.has(member.userId);
              return (
                <li
                  key={member.userId}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <span className="relative">
                    <Avatar
                      name={member.name}
                      seed={member.userId}
                      avatar={member.avatar}
                      size="sm"
                    />
                    {online ? (
                      <span
                        className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-raised"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  <span className={`min-w-0 truncate ${online ? 'text-content' : 'text-muted'}`}>
                    {member.name}
                    <span className="sr-only">{online ? ', here now' : ''}</span>
                  </span>
                  {member.kind === 'agent' && <AgentBadge />}
                </li>
              );
            })}
          </ul>
          <Link
            href={`/workspaces/${workspaceId}/people`}
            onClick={() => setOpen(false)}
            className="mt-1.5 block rounded-md border-t border-line px-2 pt-2 pb-1 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Invitations, roles and agents
          </Link>
        </div>
      )}
    </div>
  );
}
