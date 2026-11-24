import { describe, expect, test } from 'bun:test';
import { addDays, daysLeftLine } from '@robis/web/features/cycles/cycle-days.ts';
import { cyclesOn } from '@robis/web/features/sapha/cycle-answer-model.ts';

/**
 * Which running cycles Sapha answers about when a board is named, and how
 * the days left are said.
 */

const on = (projectName: string, projectKey: string) => ({ projectName, projectKey });
const CYCLES = [on('Web', 'WEB'), on('Web Relaunch', 'REL'), on('App', 'APP')];

describe('the board a cycle question named', () => {
  test('every running cycle when none was named', () => {
    expect(cyclesOn(CYCLES, null)).toEqual(CYCLES);
  });

  test('the key exactly, else the name exactly, else a name holding the words', () => {
    expect(cyclesOn(CYCLES, 'rel')).toEqual([on('Web Relaunch', 'REL')]);
    expect(cyclesOn(CYCLES, 'web')).toEqual([on('Web', 'WEB')]);
    expect(cyclesOn(CYCLES, 'relaunch')).toEqual([on('Web Relaunch', 'REL')]);
    expect(cyclesOn(CYCLES, 'Mobile')).toEqual([]);
  });
});

describe('days left in a cycle', () => {
  test('said plainly, the last day as ending today', () => {
    expect(daysLeftLine('2026-11-24', '2026-11-29')).toBe('5 days left');
    expect(daysLeftLine('2026-11-28', '2026-11-29')).toBe('1 day left');
    expect(daysLeftLine('2026-11-29', '2026-11-29')).toBe('ends today');
    expect(addDays('2026-11-24', 13)).toBe('2026-12-07');
  });
});
