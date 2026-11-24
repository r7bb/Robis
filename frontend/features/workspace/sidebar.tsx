'use client';

import { can, contracts, type Role, type ThemeId } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { EmptyView } from '../../components/empty-view.tsx';
import { ThemePicker } from '../../components/theme-picker.tsx';
import { SectionLabel } from '../../components/ui/primitives.tsx';
import { ApiError, call } from '../../lib/api.ts';
import { useT } from '../../lib/i18n/locale-context.tsx';
import { boardHref } from '../../lib/links.ts';
import { useOverlay } from '../../lib/use-overlay.ts';
import { useMyId } from '../../lib/use-people.ts';
import { HereStack } from './here-stack.tsx';

/**
 * The left rail, and the only list of where things are: the boards, the
 * docs, and three quiet ways to the rest. Rooms and people are in the chat
 * on the right, so nothing here repeats them. Dimmer than the board, which
 * is what the eye is for.
 */

const ROW =
  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';
const rowTone = (active: boolean) =>
  active ? 'bg-accent/15 text-content' : 'text-muted hover:bg-raised hover:text-content';

/** A section title with a + that opens a one-line form for a new one. */
function AddableSection({
  title,
  addLabel,
  canAdd,
  pending,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  canAdd: boolean;
  pending: boolean;
  /** Resolves once made; a refusal keeps the field open with its reason. */
  onAdd: (name: string) => Promise<unknown>;
  children: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const plus = useRef<HTMLButtonElement>(null);

  function stop() {
    setAdding(false);
    setError(null);
    plus.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    try {
      await onAdd(trimmed);
      setName('');
      setAdding(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That could not be made. Try again.');
    }
  }

  return (
    <section className="space-y-1.5">
      <SectionLabel
        action={
          canAdd ? (
            <button
              ref={plus}
              type="button"
              onClick={() => (adding ? stop() : setAdding(true))}
              aria-expanded={adding}
              aria-label={adding ? 'Cancel' : addLabel}
              className="rounded px-1 text-sm leading-none text-faint transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {adding ? '×' : '+'}
            </button>
          ) : null
        }
      >
        {title}
      </SectionLabel>
      {adding ? (
        <form onSubmit={submit}>
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by the + just pressed, to type into
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              // Only the field closes, not the drawer around it.
              event.preventDefault();
              stop();
            }}
            name={addLabel}
            autoComplete="off"
            aria-label={addLabel}
            aria-invalid={error ? true : undefined}
            placeholder={`${addLabel}, then Enter…`}
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none"
          />
          {error ? (
            <p role="alert" className="mt-1 px-1 text-xs text-danger-soft">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {children}
    </section>
  );
}

function Boards({
  workspaceId,
  activeId,
  role,
}: {
  workspaceId: string;
  activeId: string | null;
  role: Role | undefined;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });
  const create = useMutation({
    mutationFn: (name: string) =>
      call(contracts['projects.create'], { params: { workspaceId }, body: { name } }),
    onSuccess: async ({ project }) => {
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      router.push(boardHref(workspaceId, project.id));
    },
  });
  const rows = (projects.data?.projects ?? []).filter((project) => !project.archived);
  const { t } = useT();
  const me = useMyId();

  return (
    <AddableSection
      title={t('nav.boards')}
      addLabel="New board"
      canAdd={role !== undefined && can(role, 'project:create')}
      pending={create.isPending}
      onAdd={(name) => create.mutateAsync(name)}
    >
      <ul className="space-y-px">
        {rows.map((project) => (
          <li key={project.id}>
            <Link
              href={boardHref(workspaceId, project.id)}
              aria-current={project.id === activeId ? 'page' : undefined}
              className={`${ROW} ${rowTone(project.id === activeId)}`}
            >
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <HereStack location={project.id} me={me} />
              <span className="shrink-0 text-[11px] tabular-nums text-faint">
                {project.openIssues}
                <span className="sr-only"> open issues</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {projects.isSuccess && rows.length === 0 ? (
        <p className="px-2 text-xs text-faint">{t('nav.noBoards')}</p>
      ) : null}
    </AddableSection>
  );
}

function Docs({ workspaceId, role }: { workspaceId: string; role: Role | undefined }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const router = useRouter();
  const documents = useQuery({
    queryKey: ['documents', workspaceId],
    queryFn: () => call(contracts['documents.list'], { params: { workspaceId } }),
  });
  const create = useMutation({
    mutationFn: (title: string) =>
      call(contracts['documents.create'], { params: { workspaceId }, body: { title } }),
    onSuccess: async ({ document }) => {
      await queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] });
      router.push(`/workspaces/${workspaceId}/documents/${document.id}`);
    },
  });
  const rows = documents.data?.documents ?? [];
  const { t } = useT();
  const me = useMyId();

  return (
    <AddableSection
      title={t('nav.docs')}
      addLabel="New doc"
      // Documents follow the project permission, as the API does.
      canAdd={role !== undefined && can(role, 'project:create')}
      pending={create.isPending}
      onAdd={(title) => create.mutateAsync(title)}
    >
      <ul className="space-y-px">
        {rows.map((document) => {
          const href = `/workspaces/${workspaceId}/documents/${document.id}`;
          return (
            <li key={document.id}>
              <Link
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={`${ROW} ${rowTone(pathname === href)}`}
              >
                <span className="min-w-0 flex-1 truncate">{document.title}</span>
                <HereStack location={document.id} me={me} />
              </Link>
            </li>
          );
        })}
      </ul>
      {documents.isSuccess && rows.length === 0 ? (
        <EmptyView
          view="docs"
          workspaceId={workspaceId}
          canFill={role !== undefined && can(role, 'project:create')}
          compact
        />
      ) : null}
    </AddableSection>
  );
}

/** The quiet ways to the rest, each a page in the middle. */
function MoreLinks({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const { t } = useT();
  const links = [
    { href: `/workspaces/${workspaceId}/feed`, label: t('nav.feed') },
    { href: `/workspaces/${workspaceId}/spaces`, label: t('nav.spaces') },
    { href: `/workspaces/${workspaceId}/meetings`, label: t('nav.meetings') },
    { href: `/workspaces/${workspaceId}/calendar`, label: t('nav.calendar') },
    { href: `/workspaces/${workspaceId}/activity`, label: t('nav.activity') },
    { href: `/workspaces/${workspaceId}/insights`, label: t('nav.insights') },
    { href: `/workspaces/${workspaceId}/releases`, label: t('nav.releases') },
    { href: `/workspaces/${workspaceId}/automations`, label: t('nav.automations') },
    { href: `/workspaces/${workspaceId}/people`, label: t('nav.people') },
  ];
  return (
    <ul className="space-y-px">
      {links.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            aria-current={pathname === link.href ? 'page' : undefined}
            className={`${ROW} ${rowTone(pathname === link.href || pathname.startsWith(`${link.href}/`))}`}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({
  workspaceId,
  projectId,
  role,
  theme,
  open,
  onClose,
}: {
  workspaceId: string;
  projectId: string | null;
  role: Role | undefined;
  theme: ThemeId;
  /** On a phone the rail is a drawer, opened from the top bar. */
  open: boolean;
  onClose: () => void;
}) {
  const drawer = useRef<HTMLElement>(null);
  useOverlay({
    active: open,
    onClose,
    panel: drawer,
    returnFocus: () => document.querySelector<HTMLElement>('[data-menu-toggle]'),
  });

  const rail = (
    <nav
      ref={drawer}
      id="workspace-menu"
      aria-label="Workspace"
      className={`w-56 shrink-0 flex-col gap-5 overflow-y-auto bg-surface px-3 py-4 ${
        open
          ? 'fixed inset-y-0 left-0 z-30 flex overscroll-contain border-r border-line pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl shadow-black/30 md:static md:z-auto md:border-r-0 md:shadow-none'
          : 'hidden md:flex'
      }`}
    >
      {open ? (
        <button
          type="button"
          onClick={onClose}
          className="self-end rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft md:hidden"
        >
          Close
        </button>
      ) : null}
      <Boards workspaceId={workspaceId} activeId={projectId} role={role} />
      <Docs workspaceId={workspaceId} role={role} />

      <div className="mt-auto space-y-3 pt-2">
        <MoreLinks workspaceId={workspaceId} />
        {role ? (
          // Collapsed: six labelled buttons for something changed once per workspace.
          <details className="px-2">
            <summary className="cursor-pointer rounded text-xs text-faint transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft">
              Theme
            </summary>
            <div className="mt-2">
              <ThemePicker
                workspaceId={workspaceId}
                current={theme}
                canEdit={can(role, 'workspace:update')}
              />
            </div>
          </details>
        ) : null}
      </div>
    </nav>
  );

  if (!open) return rail;
  return (
    <>
      <button
        type="button"
        aria-label="Close the menu"
        onClick={onClose}
        tabIndex={-1}
        className="fixed inset-0 z-20 bg-black/40 md:hidden"
      />
      {rail}
    </>
  );
}
