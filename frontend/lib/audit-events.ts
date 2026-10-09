/**
 * Plain-language phrasing for audit events.
 *
 * Shared by the activity feed and the security view, so an event reads the
 * same in both. Built from the stored payload, never by refetching what it
 * names: an entry has to stay truthful after the issue is deleted or the
 * title changes, so it says what the values were at the time.
 */

type Payload = Record<string, unknown>;

function text(payload: Payload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

export function label(value: string | undefined): string {
  return value ? value.toLowerCase().replaceAll('_', ' ') : 'unknown';
}

function named(prefix: string, value: string | undefined): string {
  return value ? `${prefix} ${value}` : prefix;
}

function moved(payload: Payload): string {
  return `from ${label(text(payload, 'from'))} to ${label(text(payload, 'to'))}`;
}

function issue(payload: Payload, verb: string): string {
  const title = text(payload, 'title');
  return `${verb} ${text(payload, 'key') ?? 'an issue'}${title ? ` · ${title}` : ''}`;
}

function channel(payload: Payload, verb: string): string {
  const name = text(payload, 'name');
  return name ? `${verb} #${name}` : `${verb} a channel`;
}

function removal(payload: Payload, what: string): string {
  return payload.moderated === true ? `removed someone's ${what}` : `deleted a ${what}`;
}

/** One phrasing per event type. */
const PHRASES: Record<string, (payload: Payload) => string> = {
  'issue.created': (p) => issue(p, 'created'),
  'issue.status_changed': (p) => `moved ${text(p, 'key') ?? 'an issue'} ${moved(p)}`,
  'issue.updated': (p) => `edited ${text(p, 'key') ?? 'an issue'}`,
  'issue.deleted': (p) => issue(p, 'deleted'),
  'project.created': (p) => named('created the project', text(p, 'name')),
  'project.updated': (p) => named('edited the project', text(p, 'name')),
  'project.deleted': (p) => named('deleted the project', text(p, 'name')),
  'workspace.created': () => 'created this workspace',
  'workspace.updated': () => 'updated the workspace',
  'member.added': (p) => `added ${text(p, 'email') ?? 'a member'} as ${label(text(p, 'role'))}`,
  'member.removed': (p) => `removed ${text(p, 'email') ?? 'a member'}`,
  'member.left': () => 'left the workspace',
  'member.role_changed': (p) => `changed ${text(p, 'email') ?? 'a member'} ${moved(p)}`,
  'comment.created': () => 'commented on an issue',
  'comment.deleted': (p) => removal(p, 'comment'),
  'message.deleted': (p) => removal(p, 'message'),
  'document.created': (p) => named('created the document', text(p, 'title')),
  'document.updated': (p) => `renamed a document to ${text(p, 'to') ?? 'something new'}`,
  'document.deleted': (p) => named('deleted the document', text(p, 'title')),
  'channel.created': (p) => channel(p, 'created'),
  'channel.updated': (p) => channel(p, 'edited'),
  'channel.deleted': (p) => channel(p, 'deleted'),
  'meeting.created': (p) => named('scheduled', text(p, 'title')),
  'meeting.updated': (p) => named('changed the meeting', text(p, 'title')),
  'meeting.canceled': (p) => named('cancelled', text(p, 'title')),
  'meeting.responded': (p) => {
    const response = text(p, 'response');
    return `${response ? `answered ${response} to` : 'answered'} ${text(p, 'title') ?? 'a meeting'}`;
  },
};

/**
 * Describe an event. Unknown types fall back to the raw name: better an
 * unstyled truth than an event dropped because this module has not been
 * taught about it yet.
 */
export function describeEvent(eventType: string, payload: Payload): string {
  const phrase = Object.hasOwn(PHRASES, eventType) ? PHRASES[eventType] : undefined;
  return phrase ? phrase(payload) : eventType;
}
