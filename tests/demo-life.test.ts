import { describe, expect, test } from 'bun:test';
import * as content from '@robis/scripts/demo/content.ts';
import {
  ACTIONS,
  MAX_OPEN_ISSUES,
  mayDo,
  nextAction,
  nextStatus,
  pause,
  pickFresh,
  pickWeighted,
  RECENT_LINES,
  remember,
} from '@robis/scripts/demo/plan.ts';

/**
 * The demo's life (demo:life): who may do what, how choices are weighed,
 * that no line repeats while fresh ones remain, and that the written lines
 * keep the house rules. The runner itself was watched against the stack.
 */

/** A random source that returns the given values in turn. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('who may do what', () => {
  test('a guest talks, comments and reacts, but files, moves and posts nothing', () => {
    expect(mayDo('GUEST', 'chat')).toBe(true);
    expect(mayDo('GUEST', 'react')).toBe(true);
    expect(mayDo('GUEST', 'postComment')).toBe(true);
    expect(mayDo('GUEST', 'answer')).toBe(true);
    expect(mayDo('GUEST', 'markHelpful')).toBe(true);
    for (const action of ['file', 'move', 'post', 'ask'] as const) {
      expect(mayDo('GUEST', action)).toBe(false);
    }
  });

  test('an agent works and posts, but does not react', () => {
    expect(mayDo('AGENT', 'move')).toBe(true);
    expect(mayDo('AGENT', 'file')).toBe(true);
    expect(mayDo('AGENT', 'react')).toBe(false);
  });

  test('members and admins may do everything', () => {
    for (const action of ACTIONS) {
      expect(mayDo('MEMBER', action)).toBe(true);
      expect(mayDo('ADMIN', action)).toBe(true);
    }
  });

  test('what comes next is only ever allowed for that role', () => {
    for (let i = 0; i < 200; i++) {
      const action = nextAction('GUEST', 0, Math.random);
      expect(action === null || mayDo('GUEST', action)).toBe(true);
    }
  });
});

describe('weighing the choices', () => {
  test('each choice as likely as its weight', () => {
    const choices = [
      { value: 'a', weight: 1 },
      { value: 'b', weight: 3 },
    ];
    expect(pickWeighted(choices, () => 0)).toBe('a');
    expect(pickWeighted(choices, () => 0.24)).toBe('a');
    expect(pickWeighted(choices, () => 0.26)).toBe('b');
    expect(pickWeighted(choices, () => 0.999)).toBe('b');
    expect(pickWeighted([{ value: 'x', weight: 0 }], () => 0.5)).toBeNull();
  });

  test('past the open-issue limit nobody files another', () => {
    for (let i = 0; i < 300; i++) {
      expect(nextAction('MEMBER', MAX_OPEN_ISSUES, Math.random)).not.toBe('file');
    }
  });

  test('issues move one step along the board, and stop at done', () => {
    expect(nextStatus('TODO')).toBe('IN_PROGRESS');
    expect(nextStatus('IN_PROGRESS')).toBe('IN_REVIEW');
    expect(nextStatus('IN_REVIEW')).toBe('DONE');
    expect(nextStatus('DONE')).toBeNull();
    expect(nextStatus('CANCELED')).toBeNull();
  });

  test('pauses fall between their bounds', () => {
    expect(pause(20_000, 60_000, () => 0)).toBe(20_000);
    expect(pause(20_000, 60_000, () => 0.5)).toBe(40_000);
    expect(pause(20_000, 60_000, () => 0.9999)).toBeLessThanOrEqual(60_000);
  });
});

describe('fresh lines', () => {
  test('a line said lately is not said again while others remain', () => {
    const bank = ['one', 'two', 'three'];
    expect(pickFresh(bank, ['one', 'two'], sequence(0))).toBe('three');
    // Every line said lately: any will do.
    expect(bank).toContain(pickFresh(bank, bank, sequence(0.5)));
    expect(() => pickFresh([], [], Math.random)).toThrow(RangeError);
  });

  test('only the last few lines are remembered', () => {
    let recent: string[] = [];
    for (let i = 0; i < RECENT_LINES + 5; i++) recent = remember(recent, `line ${i}`);
    expect(recent).toHaveLength(RECENT_LINES);
    expect(recent.at(-1)).toBe(`line ${RECENT_LINES + 4}`);
  });
});

describe('the written lines', () => {
  const banks = Object.entries(content).flatMap(([name, value]) =>
    Array.isArray(value)
      ? [[name, value as string[]] as const]
      : Object.entries(value as Record<string, string[]>).map(
          ([channel, lines]) => [`${name}.${channel}`, lines] as const,
        ),
  );

  test('every bank has enough lines that repeats are rare', () => {
    for (const [, lines] of banks) expect(lines.length).toBeGreaterThanOrEqual(6);
  });

  test('no em or en dashes, no duplicates within a bank, nothing too long to post', () => {
    for (const [name, lines] of banks) {
      expect({ name, dashed: lines.filter((line) => /[–—]/.test(line)) }).toEqual({
        name,
        dashed: [],
      });
      expect(new Set(lines).size).toBe(lines.length);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('writing together', () => {
  test('the oldest note gives way once a document holds enough of them', async () => {
    const { oldestNoteToDrop } = await import('@robis/scripts/demo/write-together.ts');
    const { NOTES_KEPT } = await import('@robis/scripts/demo/doc-content.ts');
    const head = 'Launch plan\n\nNotes\n';
    const notes = Array.from({ length: NOTES_KEPT }, (_, i) => `- note ${i + 1}`);
    expect(oldestNoteToDrop(head + notes.slice(1).join('\n'))).toBeNull();
    const full = `${head}${notes.join('\n')}\n`;
    const drop = oldestNoteToDrop(full);
    expect(full.slice(drop!.from, drop!.from + drop!.length)).toBe('- note 1\n');
    expect(oldestNoteToDrop('No notes heading here')).toBeNull();
  });

  test('every sample document is plain, short and dash-free', async () => {
    const { SAMPLE_DOCUMENTS } = await import('@robis/scripts/demo/doc-content.ts');
    for (const sample of SAMPLE_DOCUMENTS) {
      expect(sample.opening).toContain('\nNotes\n');
      expect(sample.lines.length).toBeGreaterThanOrEqual(6);
      for (const line of [sample.opening, ...sample.lines]) expect(/[–—]/.test(line)).toBe(false);
    }
  });
});
