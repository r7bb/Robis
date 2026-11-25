import { describe, expect, test } from 'bun:test';
import { createProjectSchema } from '@robis/shared';
import { BOARD_STARTS, newBoardBody } from '@robis/web/lib/new-board.ts';

/**
 * What a new board is made with, from first run or the sidebar alike: a
 * name, and a starting template unless it begins empty.
 */

describe('a new board', () => {
  test('empty carries no template', () => {
    expect(newBoardBody('  Launch  ', 'blank')).toEqual({ name: 'Launch' });
  });

  test('a template is sent by its id', () => {
    expect(newBoardBody('Launch', 'event')).toEqual({ name: 'Launch', template: 'event' });
  });

  test('every starting choice makes a body the API accepts', () => {
    for (const start of BOARD_STARTS) {
      expect(createProjectSchema.safeParse(newBoardBody('Launch', start)).success).toBe(true);
    }
  });

  test('empty is offered first, then each template', () => {
    expect(BOARD_STARTS).toEqual(['blank', 'software', 'event', 'coursework']);
  });
});
