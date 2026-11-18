import { describe, expect, test } from 'bun:test';
import { can, ROLES } from '@robis/shared';
import { ACTIONS, type Action, may } from '@robis/web/lib/permissions.ts';

/**
 * The checks the web app makes before it shows a button or a command (C2).
 * Each is the API's own permission, so the screen never offers what the
 * server would refuse, and never hides what it would allow.
 */
describe('may', () => {
  test('is the API permission for every role and action', () => {
    for (const role of ROLES) {
      for (const action of Object.keys(ACTIONS) as Action[]) {
        expect(may(role, action), `${role} ${action}`).toBe(can(role, ACTIONS[action]));
      }
    }
  });

  test('nothing before the role is known', () => {
    for (const action of Object.keys(ACTIONS) as Action[]) {
      expect(may(undefined, action)).toBe(false);
    }
  });

  test('a guest reads boards but files, changes and deletes nothing', () => {
    expect(may('GUEST', 'openBoard')).toBe(true);
    expect(may('GUEST', 'newIssue')).toBe(false);
    expect(may('GUEST', 'editIssue')).toBe(false);
    expect(may('GUEST', 'deleteIssue')).toBe(false);
    expect(may('GUEST', 'saveView')).toBe(false);
  });

  test('a member does all of it', () => {
    for (const action of Object.keys(ACTIONS) as Action[]) {
      expect(may('MEMBER', action), action).toBe(true);
    }
  });
});
