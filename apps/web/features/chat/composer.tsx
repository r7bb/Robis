'use client';

import { MESSAGE_MAX_LENGTH } from '@relay/shared/limits';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { Button, InlineError } from '../../components/ui/primitives.tsx';

/** Show the remaining-characters hint only when it is nearly relevant. */
const COUNTER_VISIBLE_FROM = MESSAGE_MAX_LENGTH - 200;

/**
 * The message box.
 *
 * Enter sends and Shift+Enter inserts a newline, which is the convention
 * every chat client has settled on. The textarea grows with its content up to
 * a ceiling, past which it scrolls -- an unbounded box pushes the transcript
 * off the screen.
 */
const MAX_ROWS_PX = 160;

export function Composer({
  channelName,
  disabled,
  sending,
  error,
  onSend,
}: {
  channelName: string;
  disabled: boolean;
  sending: boolean;
  error: string | null;
  onSend: (body: string) => void;
}) {
  const [body, setBody] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const element = textarea.current;
    if (!element) return;

    // Reset first: without it the height only ever grows, because
    // `scrollHeight` of an already-tall box includes the space it is taking.
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_ROWS_PX)}px`;
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();

    const trimmed = body.trim();
    if (!trimmed || disabled || sending) return;

    onSend(trimmed);
    setBody('');

    // The box has to shrink back by hand; clearing the value does not fire
    // the input event that would normally drive `resize`.
    requestAnimationFrame(resize);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // `isComposing` guards an IME: pressing Enter to choose a candidate in
    // Japanese or Korean input must commit the word, not send a half-typed
    // message.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    submit();
  }

  const remaining = MESSAGE_MAX_LENGTH - body.length;

  return (
    <form onSubmit={submit} className="border-t border-line bg-raised px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textarea}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={disabled ? 'Pick a channel to start talking' : `Message #${channelName}`}
          aria-label={`Message #${channelName}`}
          className="max-h-40 flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft disabled:opacity-50"
        />

        <Button
          type="submit"
          variant="primary"
          disabled={disabled || sending || body.trim().length === 0}
        >
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="text-[10px] text-faint">
          <kbd className="rounded border border-line px-1">Enter</kbd> to send,{' '}
          <kbd className="rounded border border-line px-1">Shift</kbd>+
          <kbd className="rounded border border-line px-1">Enter</kbd> for a new line
        </p>

        {body.length > COUNTER_VISIBLE_FROM ? (
          <span className={`text-[10px] ${remaining < 0 ? 'text-danger-soft' : 'text-faint'}`}>
            {remaining} left
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-2">
          <InlineError>{error}</InlineError>
        </div>
      ) : null}
    </form>
  );
}
