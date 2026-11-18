'use client';

import type { Role } from '@robis/shared';
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { Kbd } from '../../components/ui/kbd.tsx';
import {
  allowedCommands,
  arrangeCommands,
  type Command,
  rankCommands,
} from '../../lib/commands.ts';
import { usePaletteSources } from './use-palette-sources.ts';

/**
 * The command palette (C2): a modal over the page, one field and a list.
 * Typing narrows it; arrows move, Enter chooses, Escape steps back out of a
 * second list and then closes. A native <dialog> opened with showModal()
 * keeps focus inside and leaves the page behind it inert.
 *
 * The field is a combobox and the list its listbox, so a screen reader
 * hears the option the arrows land on while focus stays in the field.
 */
export function CommandPalette({
  workspaceId,
  role,
  pageCommands,
  onClose,
}: {
  workspaceId: string;
  role: Role | undefined;
  pageCommands: readonly Command[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  // The lists opened on the way here: Change status… then its statuses.
  const [stack, setStack] = useState<readonly Command[]>([]);
  const [active, setActive] = useState(0);
  const parent = stack.at(-1);

  const { local, found, searching } = usePaletteSources(
    workspaceId,
    parent ? '' : query,
    pageCommands.some((c) => c.id === 'new-issue'),
  );

  const sections = parent
    ? arrangeCommands(rankCommands(allowedCommands(parent.children ?? [], role), query), {
        browsing: false,
      })
    : arrangeCommands(
        [
          ...rankCommands(allowedCommands([...pageCommands, ...local], role), query),
          ...allowedCommands(found, role),
        ],
        { browsing: !query.trim() },
      );
  const items = sections.flatMap((section) => section.commands);
  const current = Math.min(active, Math.max(items.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;

  useOpenModal(dialogRef);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function show(next: readonly Command[]) {
    setStack(next);
    setQuery('');
    setActive(0);
  }

  function choose(command: Command | undefined) {
    if (!command) return;
    if (command.children) return show([...stack, command]);
    onClose();
    // Once the palette is gone and focus is back, so the command can move it.
    requestAnimationFrame(() => command.run?.());
  }

  /** Escape steps out of a second list before it closes the palette. */
  function back() {
    if (parent) show(stack.slice(0, -1));
    else onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    // Handled here rather than left to the dialog's cancel, which Chrome
    // lets through unprevented on a second Escape with no typing between.
    if (event.key === 'Escape') {
      event.preventDefault();
      return back();
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step && items.length > 0) {
      event.preventDefault();
      setActive((current + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[current]);
    } else if (event.key === 'Backspace' && query === '' && parent) {
      event.preventDefault();
      show(stack.slice(0, -1));
    }
  }

  let index = -1;
  return (
    <dialog
      ref={dialogRef}
      aria-label="Command palette"
      // Escape with focus off the field (it rarely is).
      onCancel={(event) => {
        event.preventDefault();
        back();
      }}
      // Only a close that left it closed: in development React mounts twice,
      // and the first unmount's close arrives after the second has reopened it.
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      className="palette m-0 mx-auto mt-[12vh] w-[min(40rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-line bg-raised p-0 text-content shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <SearchGlyph />
        {stack.map((step) => (
          <span
            key={step.id}
            className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs text-muted"
          >
            {step.title.replace(/…$/, '')}
          </span>
        ))}
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length > 0 ? optionId(current) : undefined}
          aria-label={parent ? parent.title : 'Search or run a command'}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            parent ? 'Choose…' : 'Search issues, docs, channels, people, or run a command…'
          }
          className="h-12 min-w-0 flex-1 text-ellipsis bg-transparent text-[15px] text-content outline-none placeholder:text-faint"
        />
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="max-h-[min(24rem,58vh)] overflow-y-auto overscroll-contain p-2"
      >
        {sections.map((section) => (
          // biome-ignore lint/a11y/useSemanticElements: options in a listbox are grouped by role="group"; a fieldset groups form controls.
          <div key={section.group} role="group" aria-label={section.group} className="pb-1">
            <p
              aria-hidden="true"
              className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-faint"
            >
              {section.group}
            </p>
            {section.commands.map((command) => {
              index += 1;
              const at = index;
              return (
                <Option
                  key={command.id}
                  id={optionId(at)}
                  index={at}
                  command={command}
                  selected={at === current}
                  onPoint={() => setActive(at)}
                  onChoose={() => choose(command)}
                />
              );
            })}
          </div>
        ))}
      </div>
      {/* Outside the listbox, which holds options and nothing else. */}
      {items.length === 0 && (
        <p className="px-2.5 pb-8 pt-6 text-center text-sm text-faint">
          {searching ? 'Searching…' : `Nothing matches “${query.trim()}”.`}
        </p>
      )}

      {/* Always mounted, so a change of count is announced. */}
      <p className="sr-only" aria-live="polite">
        {searching ? 'Searching' : `${items.length} ${items.length === 1 ? 'result' : 'results'}`}
      </p>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-faint">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> to choose
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> {parent ? 'to go back' : 'to close'}
        </span>
        {searching && items.length > 0 && <span className="ml-auto">Searching…</span>}
      </footer>
    </dialog>
  );
}

function Option({
  id,
  index,
  command,
  selected,
  onPoint,
  onChoose,
}: {
  id: string;
  index: number;
  command: Command;
  selected: boolean;
  onPoint: () => void;
  onChoose: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keys are the combobox field's (aria-activedescendant); this click is for pointers.
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      data-index={index}
      onMouseMove={selected ? undefined : onPoint}
      // Keep focus in the field, where the keys are handled.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className={`relative flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors duration-100 ${
        selected ? 'bg-surface text-content' : 'text-muted'
      }`}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{command.title}</span>
      {command.hint && <span className="shrink-0 text-xs text-faint">{command.hint}</span>}
      {command.children && (
        <span aria-hidden="true" className="shrink-0 text-faint">
          ›
        </span>
      )}
    </div>
  );
}

/**
 * Open the dialog as a modal once it mounts, and put focus back where it
 * was when it goes: a dialog removed rather than closed would leave focus
 * on the page body.
 */
function useOpenModal(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}

function SearchGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="h-4 w-4 shrink-0 text-faint"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </svg>
  );
}
