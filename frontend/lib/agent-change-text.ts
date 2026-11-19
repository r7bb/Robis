/**
 * An agent's change in plain words, for the agents page (idea 6): what it
 * did, on which issue, from what to what. Long values (a description) are
 * named rather than shown, as the issue has them.
 */

type Change = {
  agentName: string;
  entityType: 'issue' | 'comment';
  issueKey: string | null;
  field: string;
  before: unknown;
  after: unknown;
};

const FIELD_NAMES: Record<string, string> = {
  title: 'the title',
  description: 'the description',
  status: 'the status',
  priority: 'the priority',
  dueOn: 'the due date',
  parentId: 'the parent issue',
};

const STATUS_WORDS: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
  CANCELED: 'Canceled',
};

/** One value as a person reads it, or null when it is not worth spelling out. */
export function valueWords(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return 'none';
  if (field === 'description' || field === 'parentId') return null;
  if (field === 'status') return STATUS_WORDS[String(value)] ?? String(value);
  if (field === 'priority') return String(value).toLowerCase();
  const text = String(value);
  return field === 'title' ? `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”` : text;
}

/** The sentence: "Triage bot set the priority on REL-4 from none to high". */
export function describeAgentChange(change: Change): string {
  const on = change.issueKey ?? 'a deleted issue';
  if (change.entityType === 'comment') return `${change.agentName} commented on ${on}`;
  if (change.field === 'created') return `${change.agentName} opened ${on}`;
  const field = FIELD_NAMES[change.field] ?? change.field;
  const from = valueWords(change.field, change.before);
  const to = valueWords(change.field, change.after);
  if (from === null || to === null) return `${change.agentName} changed ${field} on ${on}`;
  return `${change.agentName} set ${field} on ${on} from ${from} to ${to}`;
}
