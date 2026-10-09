/**
 * What has shipped, newest first.
 *
 * The one source for the landing page's "What's new" and the README's list
 * of the same name. `tests/changelog.test.ts` fails if an entry here is
 * missing from the README, so the two cannot drift apart. Every entry says
 * how it was checked, because a changelog that only announces is the part
 * of a project page nobody believes.
 */

export type Area = 'Product' | 'ML' | 'Security' | 'Site';

export type Entry = {
  date: string;
  area: Area;
  title: string;
  summary: string;
  /** How it is known to work: tests, measurements, or what was verified. */
  checked: string;
};

export const CHANGELOG: readonly Entry[] = [
  {
    date: '2026-10-09',
    area: 'Security',
    title: 'A tamper-evident audit trail',
    summary:
      'Every change in a workspace is recorded in the same transaction as the change, numbered, and chained with SHA-256, so an edited or deleted event is named when the chain is checked. Admins get a security view and an export, and an operator can stream the trail to a SIEM over HTTPS.',
    checked:
      'Tests tamper with the trail three ways and verification names each one; a stand-in receiver gets every event exactly once by key after a forced retry through the job queue; a rolled-back change leaves no event.',
  },
  {
    date: '2026-10-09',
    area: 'Security',
    title: 'Request hardening',
    summary:
      'The API no longer trusts any client to name its own address, every request carries an id from the API through to the ML service, and pages with a token in the link send no referrer and are never cached.',
    checked:
      'Tests prove a spoofed X-Forwarded-For is ignored by default, an injected id is replaced rather than echoed, and the id reaches a stand-in ML service.',
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Priority suggestions in the composer',
    summary:
      'Typing an issue title offers a suggested priority with its score, filed only if you press Use. Below 40 triaged issues the model says so instead of guessing.',
    checked:
      'Route, parser and HTTP client tests, including a non-member who gets a 404 before the model is ever asked.',
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Duplicate detection, measured',
    summary:
      'A labelled set of 84 queries, with the threshold chosen on one half and reported on the other: precision 0.79, recall 0.62, and none of the 7 duplicates that share almost no words.',
    checked:
      'A test keeps the default threshold equal to the one the evaluation chose, so it cannot quietly go back to a guess.',
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Character n-grams tried, and not adopted',
    summary:
      'Five representations compared against a rule fixed in advance. None found more reworded duplicates without more false alarms, so production stays as it was.',
    checked: 'Reproducible with python -m robis_ml.duplicate_eval --compare.',
  },
  {
    date: '2026-10-09',
    area: 'Site',
    title: 'A live landing page',
    summary:
      'The name, letter by letter, over a WebGL field that acts each letter out, then a demo where you cut the network, type on both sides and watch it merge.',
    checked: 'The demo runs on real Yjs documents, with tests holding it to "nothing is lost".',
  },
  {
    date: '2026-10-08',
    area: 'Security',
    title: 'An authenticated ML service',
    summary:
      'The ML service needs a token and refuses to start without one. Duplicate hints reach the composer, and a broken service only ever means no hints.',
    checked:
      'Tests for tenant isolation between workspaces and for every way the service can fail.',
  },
];

export const AREAS: readonly Area[] = ['Product', 'ML', 'Security', 'Site'];
