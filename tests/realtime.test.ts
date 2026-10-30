import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { users } from '@robis/database';
import { createGateway } from '@robis/realtime/gateway';
import type { ServerMessage } from '@robis/shared';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as Y from 'yjs';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  GATEWAY_TEST_ROLE,
  getHarness,
  request,
  resetDatabase,
  TEST_URL,
} from './harness.ts';

/**
 * Integration tests for the WebSocket gateway.
 *
 * These run a real gateway against a real Postgres and connect with a real
 * WebSocket client. The whole point of this layer is the interaction between
 * three processes -- API commits, Postgres notifies, gateway fans out -- and
 * none of that is exercised by unit-testing the pieces.
 */

let gateway: Awaited<ReturnType<typeof createGateway>>;
let listenClient: postgres.Sql;
let wsUrl: string;

beforeAll(async () => {
  // As the gateway's own role (stage 1, item 8), which runs its LISTEN too:
  // a grant it lacks fails here, not in a deployment.
  const { gatewayDb } = await getHarness();
  const gatewayUrl = new URL(TEST_URL);
  gatewayUrl.username = GATEWAY_TEST_ROLE.role;
  gatewayUrl.password = GATEWAY_TEST_ROLE.password;
  listenClient = postgres(gatewayUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });

  // Port 0 lets the OS pick a free one, so the suite can't collide with a dev
  // gateway that happens to be running.
  gateway = await createGateway({
    db: gatewayDb,
    listenClient,
    port: 0,
    webOrigin: 'http://localhost:3000',
  });
  wsUrl = `ws://127.0.0.1:${gateway.port}/ws`;
});

beforeEach(resetDatabase);

afterAll(async () => {
  await gateway.close();
  await listenClient.end({ timeout: 5 });
  await closeHarness();
});

/** A connected client that records everything the gateway sends. */
class TestClient {
  readonly messages: ServerMessage[] = [];
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.messages.push(JSON.parse(String(event.data)) as ServerMessage);
    });
  }

  static async connect(actor: Actor, url = wsUrl): Promise<TestClient> {
    const socket = new WebSocket(url, { headers: { cookie: actor.cookie } } as never);

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), {
        once: true,
      });
    });

    return new TestClient(socket);
  }

  send(message: unknown) {
    this.socket.send(JSON.stringify(message));
  }

  /** Wait for a message matching `predicate`, or throw on timeout. */
  async waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    timeoutMs = 5000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await Bun.sleep(25);
    }

    throw new Error(`Timed out. Received: ${JSON.stringify(this.messages.map((m) => m.type))}`);
  }

  /** Open a document room and wait for the catch-up state. */
  async openDocument(documentId: string) {
    this.send({ type: 'doc.open', documentId });
    return this.waitFor(
      (m): m is Extract<ServerMessage, { type: 'doc.sync' }> => m.type === 'doc.sync',
    );
  }

  sendUpdate(documentId: string, doc: Y.Doc, since?: Uint8Array) {
    const update = since ? Y.encodeStateAsUpdate(doc, since) : Y.encodeStateAsUpdate(doc);
    this.send({
      type: 'doc.update',
      documentId,
      update: Buffer.from(update).toString('base64'),
    });
  }

  async subscribe(workspaceId: string) {
    this.send({ type: 'subscribe', workspaceId });
    return this.waitFor((m): m is Extract<ServerMessage, { type: 'ready' }> => m.type === 'ready');
  }

  close() {
    this.socket.close();
  }
}

const isEvent =
  (type: string) =>
  (m: ServerMessage): m is Extract<ServerMessage, { type: 'event' }> =>
    m.type === 'event' && m.event.type === type;

const isError = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> =>
  m.type === 'error';

const isPresence = (m: ServerMessage): m is Extract<ServerMessage, { type: 'presence' }> =>
  m.type === 'presence';

describe('connection', () => {
  test('rejects a socket with no session cookie', async () => {
    const socket = new WebSocket(wsUrl);

    const failed = await new Promise<boolean>((resolve) => {
      socket.addEventListener('open', () => resolve(false), { once: true });
      socket.addEventListener('error', () => resolve(true), { once: true });
      socket.addEventListener('close', () => resolve(true), { once: true });
    });

    expect(failed).toBe(true);
  });

  test('accepts a socket with a valid session', async () => {
    const actor = await createActor('Ada');
    const client = await TestClient.connect(actor);
    const workspace = await createWorkspace(actor);

    const ready = await client.subscribe(workspace.id);

    expect(ready.userId).toBe(actor.id);
    expect(ready.workspaceId).toBe(workspace.id);
    client.close();
  });

  /**
   * The socket carries the same cookie as the REST API, so it needs the same
   * tenant check. Authentication alone would let any account watch any
   * workspace's traffic.
   */
  test('refuses to subscribe to a workspace you are not a member of', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);

    const client = await TestClient.connect(stranger);
    client.send({ type: 'subscribe', workspaceId: workspace.id });

    const error = await client.waitFor(isError);
    expect(error.message).toContain('Not a member');

    client.close();
  });

  /** The API refuses a member without a picture; the live feed must too. */
  test('refuses a member who has not chosen a picture yet', async () => {
    const owner = await createActor('Owner');
    const newcomer = await createActor('Newcomer', { withAvatar: false });
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, newcomer, 'MEMBER');

    const client = await TestClient.connect(newcomer);
    client.send({ type: 'subscribe', workspaceId: workspace.id });

    const error = await client.waitFor(isError);
    expect(error.message).toContain('picture');
    expect(client.messages.some((m) => m.type === 'ready')).toBe(false);

    client.close();
  });

  test('refuses a member who has not agreed to the current terms', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const { db } = await getHarness();
    await db.update(users).set({ termsVersion: '2000-01-01' }).where(eq(users.id, owner.id));

    const client = await TestClient.connect(owner);
    client.send({ type: 'subscribe', workspaceId: workspace.id });

    const error = await client.waitFor(isError);
    expect(error.message).toContain('terms');
    expect(client.messages.some((m) => m.type === 'ready')).toBe(false);

    client.close();
  });
});

describe('event fan-out', () => {
  test('an issue created over REST reaches a subscribed socket', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);

    const client = await TestClient.connect(owner);
    await client.subscribe(workspace.id);

    const created = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      payload: { title: 'Realtime please' },
      actor: owner,
    });
    expect(created.statusCode).toBe(201);

    const message = await client.waitFor(isEvent('issue.created'));
    expect(message.event).toMatchObject({
      type: 'issue.created',
      workspaceId: workspace.id,
      projectId: project.id,
      actorId: owner.id,
    });

    client.close();
  });

  test('a second member watching the same workspace also receives it', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const watcher = await TestClient.connect(member);
    await watcher.subscribe(workspace.id);

    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      payload: { title: 'Seen by both' },
      actor: owner,
    });

    const message = await watcher.waitFor(isEvent('issue.created'));
    expect(message.event.workspaceId).toBe(workspace.id);

    watcher.close();
  });

  /**
   * The isolation property that matters: a socket subscribed to workspace A
   * must never see traffic from workspace B, even though both flow through the
   * same Postgres channel and the same gateway process.
   */
  test('events do not leak across workspaces', async () => {
    const alice = await createActor('Alice');
    const bob = await createActor('Bob');
    const alpha = await createWorkspace(alice, 'Alpha');
    const beta = await createWorkspace(bob, 'Beta');
    const betaProject = await createProject(bob, beta.id);

    const aliceClient = await TestClient.connect(alice);
    await aliceClient.subscribe(alpha.id);

    const bobClient = await TestClient.connect(bob);
    await bobClient.subscribe(beta.id);

    await request(`/workspaces/${beta.id}/projects/${betaProject.id}/issues`, {
      method: 'POST',
      payload: { title: 'Beta only' },
      actor: bob,
    });

    // Bob must see it...
    await bobClient.waitFor(isEvent('issue.created'));

    // ...and Alice must not. Bob's arrival proves the round trip completed, so
    // an empty inbox here is a real absence rather than a race.
    expect(aliceClient.messages.filter((m) => m.type === 'event')).toHaveLength(0);

    aliceClient.close();
    bobClient.close();
  });

  test('a status change publishes issue.updated', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);

    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        payload: { title: 'Move me' },
        actor: owner,
      })
    ).json().issue;

    const client = await TestClient.connect(owner);
    await client.subscribe(workspace.id);

    await request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
      method: 'PATCH',
      payload: { status: 'IN_PROGRESS' },
      actor: owner,
    });

    const message = await client.waitFor(isEvent('issue.updated'));
    expect(message.event).toMatchObject({ issueId: issue.id, workspaceId: workspace.id });

    client.close();
  });

  /**
   * NOTIFY is transactional: a notification emitted inside a transaction is
   * delivered only if that transaction commits. A rejected write must therefore
   * produce no event at all.
   */
  test('a rejected write produces no event', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    await addMember(owner, workspace.id, guest, 'GUEST');

    const client = await TestClient.connect(owner);
    await client.subscribe(workspace.id);

    const refused = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      payload: { title: 'Not allowed' },
      actor: guest,
    });
    expect(refused.statusCode).toBe(403);

    // Follow with a write that *is* allowed; when its event arrives we know the
    // pipeline has drained past the rejected one.
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      payload: { title: 'Allowed' },
      actor: owner,
    });
    await client.waitFor(isEvent('issue.created'));

    const createdEvents = client.messages.filter(
      (m) => m.type === 'event' && m.event.type === 'issue.created',
    );
    expect(createdEvents).toHaveLength(1);

    client.close();
  });
});

describe('presence', () => {
  test('subscribing announces you to the workspace', async () => {
    const actor = await createActor('Ada Lovelace');
    const workspace = await createWorkspace(actor);

    const client = await TestClient.connect(actor);
    await client.subscribe(workspace.id);

    const presence = await client.waitFor(isPresence);
    expect(presence.users.map((u) => u.name)).toContain('Ada Lovelace');

    client.close();
  });

  test('two members see each other', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const first = await TestClient.connect(owner);
    await first.subscribe(workspace.id);

    const second = await TestClient.connect(member);
    await second.subscribe(workspace.id);

    // The roster is rebroadcast on every join, so wait for the one with both.
    const roster = await first.waitFor(
      (m): m is Extract<ServerMessage, { type: 'presence' }> =>
        m.type === 'presence' && m.users.length === 2,
    );

    expect(roster.users.map((u) => u.name).sort()).toEqual(['Member', 'Owner']);

    first.close();
    second.close();
  });

  test('reporting a location shows what someone is looking at', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const watcher = await TestClient.connect(owner);
    await watcher.subscribe(workspace.id);

    const mover = await TestClient.connect(member);
    await mover.subscribe(workspace.id);
    mover.send({ type: 'location', location: project.id });

    const roster = await watcher.waitFor(
      (m): m is Extract<ServerMessage, { type: 'presence' }> =>
        m.type === 'presence' && m.users.some((u) => u.location === project.id),
    );

    expect(roster.users.find((u) => u.name === 'Member')?.location).toBe(project.id);

    watcher.close();
    mover.close();
  });

  test('disconnecting removes you from the roster', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const stayer = await TestClient.connect(owner);
    await stayer.subscribe(workspace.id);

    const leaver = await TestClient.connect(member);
    await leaver.subscribe(workspace.id);
    await stayer.waitFor(
      (m): m is Extract<ServerMessage, { type: 'presence' }> =>
        m.type === 'presence' && m.users.length === 2,
    );

    leaver.close();

    const roster = await stayer.waitFor(
      (m): m is Extract<ServerMessage, { type: 'presence' }> =>
        m.type === 'presence' && m.users.length === 1,
    );

    expect(roster.users.map((u) => u.name)).toEqual(['Owner']);

    stayer.close();
  });

  /** Three tabs is one person, not three. */
  test('multiple connections from one user collapse to a single entry', async () => {
    const actor = await createActor('Ada');
    const workspace = await createWorkspace(actor);

    const tabs = await Promise.all([
      TestClient.connect(actor),
      TestClient.connect(actor),
      TestClient.connect(actor),
    ]);
    for (const tab of tabs) await tab.subscribe(workspace.id);

    // Give the last join's broadcast time to land before reading the roster.
    await Bun.sleep(250);

    const latest = [...tabs[0]!.messages].reverse().find(isPresence)!;
    expect(latest.users).toHaveLength(1);
    expect(latest.users[0]!.name).toBe('Ada');

    for (const tab of tabs) tab.close();
  });
});

describe('document collaboration', () => {
  async function seedDocument(actor: Actor, workspaceId: string, title = 'Architecture') {
    const response = await request(`/workspaces/${workspaceId}/documents`, {
      method: 'POST',
      payload: { title },
      actor,
    });

    if (response.statusCode !== 201) {
      throw new Error(`Failed to create document: ${response.statusCode} ${response.body}`);
    }
    return response.json().document as { id: string; title: string };
  }

  const isDocUpdate = (m: ServerMessage): m is Extract<ServerMessage, { type: 'doc.update' }> =>
    m.type === 'doc.update';

  const isAwareness = (m: ServerMessage): m is Extract<ServerMessage, { type: 'doc.awareness' }> =>
    m.type === 'doc.awareness';

  test('opening a document returns its current state in one message', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const document = await seedDocument(owner, workspace.id);

    const author = await TestClient.connect(owner);
    await author.subscribe(workspace.id);

    const local = new Y.Doc();
    local.getText('content').insert(0, 'First draft');
    await author.openDocument(document.id);
    author.sendUpdate(document.id, local);

    // A second client joining later must receive the text without replaying
    // anything.
    const latecomer = await TestClient.connect(owner);
    await latecomer.subscribe(workspace.id);
    const sync = await latecomer.openDocument(document.id);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(Buffer.from(sync.update, 'base64')));
    expect(restored.getText('content').toString()).toBe('First draft');

    author.close();
    latecomer.close();
  });

  test('an edit reaches the other editor', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const document = await seedDocument(owner, workspace.id);

    const a = await TestClient.connect(owner);
    const b = await TestClient.connect(owner);
    await a.subscribe(workspace.id);
    await b.subscribe(workspace.id);
    await a.openDocument(document.id);
    await b.openDocument(document.id);

    const local = new Y.Doc();
    local.getText('content').insert(0, 'typed by A');
    a.sendUpdate(document.id, local);

    const forwarded = await b.waitFor(isDocUpdate);
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, new Uint8Array(Buffer.from(forwarded.update, 'base64')));

    expect(mirror.getText('content').toString()).toBe('typed by A');

    a.close();
    b.close();
  });

  /** The property CRDTs exist for, exercised through the real transport. */
  test('concurrent edits from two sockets converge', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const document = await seedDocument(owner, workspace.id);

    const a = await TestClient.connect(owner);
    const b = await TestClient.connect(owner);
    await a.subscribe(workspace.id);
    await b.subscribe(workspace.id);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    Y.applyUpdate(
      docA,
      new Uint8Array(Buffer.from((await a.openDocument(document.id)).update, 'base64')),
    );
    Y.applyUpdate(
      docB,
      new Uint8Array(Buffer.from((await b.openDocument(document.id)).update, 'base64')),
    );

    // Both type into the same empty document without seeing each other yet.
    docA.getText('content').insert(0, 'AAA');
    docB.getText('content').insert(0, 'BBB');
    a.sendUpdate(document.id, docA);
    b.sendUpdate(document.id, docB);

    // Each receives the other's update and applies it.
    const toB = await b.waitFor(isDocUpdate);
    Y.applyUpdate(docB, new Uint8Array(Buffer.from(toB.update, 'base64')));
    const toA = await a.waitFor(isDocUpdate);
    Y.applyUpdate(docA, new Uint8Array(Buffer.from(toA.update, 'base64')));

    const text = docA.getText('content').toString();
    expect(docB.getText('content').toString()).toBe(text);
    expect(text).toContain('AAA');
    expect(text).toContain('BBB');

    a.close();
    b.close();
  });

  test('edits are persisted and survive everyone leaving', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const document = await seedDocument(owner, workspace.id);

    const author = await TestClient.connect(owner);
    await author.subscribe(workspace.id);
    await author.openDocument(document.id);

    const local = new Y.Doc();
    local.getText('content').insert(0, 'Durable text');
    author.sendUpdate(document.id, local);

    // Closing the last connection flushes the debounced write.
    author.close();

    await Bun.sleep(1200);

    const fetched = await request(`/workspaces/${workspace.id}/documents/${document.id}`, {
      actor: owner,
    });
    expect(fetched.json().document.text).toBe('Durable text');
  });

  test('awareness reports who is editing, and is not persisted', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const document = await seedDocument(owner, workspace.id);

    const a = await TestClient.connect(owner);
    const b = await TestClient.connect(owner);
    await a.subscribe(workspace.id);
    await b.subscribe(workspace.id);
    await a.openDocument(document.id);
    await b.openDocument(document.id);

    a.send({ type: 'doc.awareness', documentId: document.id, state: { cursor: 7 } });

    const roster = await b.waitFor(
      (m): m is Extract<ServerMessage, { type: 'doc.awareness' }> =>
        isAwareness(m) && m.users.some((u) => u.cursor === 7),
    );
    expect(roster.users.some((u) => u.cursor === 7)).toBe(true);

    a.close();
    b.close();
  });

  /** A document id from another workspace must not be reachable. */
  test('opening a document from another workspace is refused', async () => {
    const alice = await createActor('Alice');
    const bob = await createActor('Bob');
    const alpha = await createWorkspace(alice, 'Alpha');
    const beta = await createWorkspace(bob, 'Beta');
    const betaDocument = await seedDocument(bob, beta.id);

    const client = await TestClient.connect(alice);
    await client.subscribe(alpha.id);
    client.send({ type: 'doc.open', documentId: betaDocument.id });

    const error = await client.waitFor(isError);
    expect(error.message).toContain('Document not found');

    client.close();
  });

  test('sending an update without opening the document does nothing', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const document = await seedDocument(owner, workspace.id);

    const watcher = await TestClient.connect(owner);
    await watcher.subscribe(workspace.id);
    await watcher.openDocument(document.id);

    const rogue = await TestClient.connect(owner);
    await rogue.subscribe(workspace.id);

    const local = new Y.Doc();
    local.getText('content').insert(0, 'should not appear');
    rogue.sendUpdate(document.id, local);

    // Give the gateway a chance to misbehave.
    await Bun.sleep(300);
    expect(watcher.messages.filter(isDocUpdate)).toHaveLength(0);

    watcher.close();
    rogue.close();
  });
});

/**
 * Scopes (stage 3, item 24): a client says what it is showing, and the
 * gateway sends it only the events about that. A board hears nothing of
 * chat; a channel hears nothing of a board. A client that never says gets
 * everything, which is what the home needs.
 */
describe('scopes', () => {
  async function setUp() {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const shown = await createProject(owner, workspace.id, 'Shown');
    const other = await createProject(owner, workspace.id, 'Other');
    const channels = await request(`/workspaces/${workspace.id}/channels`, { actor: owner });
    const channelId = channels.json().channels[0].id as string;
    return { owner, workspace, shown, other, channelId };
  }

  const post = (owner: Actor, workspaceId: string, channelId: string, body: string) =>
    request(`/workspaces/${workspaceId}/channels/${channelId}/messages`, {
      method: 'POST',
      actor: owner,
      payload: { body },
    });
  const file = (owner: Actor, workspaceId: string, projectId: string, title: string) =>
    request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title },
    });

  const eventTypes = (client: TestClient) =>
    client.messages.flatMap((m) => (m.type === 'event' ? [m.event.type] : []));

  test("a board hears its own project's issues, and nothing of chat or other projects", async () => {
    const { owner, workspace, shown, other, channelId } = await setUp();
    const board = await TestClient.connect(owner);
    await board.subscribe(workspace.id);
    board.send({ type: 'scopes', scopes: [{ kind: 'project', projectId: shown.id }] });
    const everything = await TestClient.connect(owner);
    await everything.subscribe(workspace.id);
    await Bun.sleep(100);

    // Unwanted first; the wanted event after them arrives last, so by then
    // anything unwanted would have arrived too.
    await post(owner, workspace.id, channelId, 'not for the board');
    await file(owner, workspace.id, other.id, 'another board');
    await file(owner, workspace.id, shown.id, 'this board');

    const mine = await board.waitFor(isEvent('issue.created'));
    expect(mine.type === 'event' && 'projectId' in mine.event && mine.event.projectId).toBe(
      shown.id,
    );
    await everything.waitFor(isEvent('message.created'));
    expect(eventTypes(board)).toEqual(['issue.created']);

    board.close();
    everything.close();
  });

  test('a channel hears its own messages, and nothing of the board', async () => {
    const { owner, workspace, shown, channelId } = await setUp();
    const chat = await TestClient.connect(owner);
    await chat.subscribe(workspace.id);
    chat.send({ type: 'scopes', scopes: [{ kind: 'channel', channelId }] });
    await Bun.sleep(100);

    await file(owner, workspace.id, shown.id, 'not for the channel');
    await post(owner, workspace.id, channelId, 'for the channel');

    await chat.waitFor(isEvent('message.created'));
    expect(eventTypes(chat)).toEqual(['message.created']);
    chat.close();
  });

  test('a client that never names scopes hears everything in the workspace', async () => {
    const { owner, workspace, shown, channelId } = await setUp();
    const home = await TestClient.connect(owner);
    await home.subscribe(workspace.id);

    await file(owner, workspace.id, shown.id, 'an issue');
    await post(owner, workspace.id, channelId, 'a message');

    await home.waitFor(isEvent('message.created'));
    expect(eventTypes(home)).toEqual(['issue.created', 'message.created']);
    home.close();
  });

  test('refuses scopes that are not scopes, and keeps the ones it had', async () => {
    const { owner, workspace, shown, channelId } = await setUp();
    const client = await TestClient.connect(owner);
    await client.subscribe(workspace.id);
    client.send({ type: 'scopes', scopes: [{ kind: 'channel', channelId }] });
    client.send({ type: 'scopes', scopes: [{ kind: 'everything' }] });
    client.send({ type: 'scopes', scopes: 'all' });
    await client.waitFor(isError);
    await Bun.sleep(100);

    await file(owner, workspace.id, shown.id, 'not for the channel');
    await post(owner, workspace.id, channelId, 'still the channel');
    await client.waitFor(isEvent('message.created'));
    expect(eventTypes(client)).toEqual(['message.created']);
    client.close();
  });
});

/**
 * Document edits between gateways (stage 3, item 25). Two editors of one
 * document can be connected to different gateway instances; each gateway
 * stores what its own editors wrote and tells the others, over NOTIFY,
 * which stored update to read. The notification carries ids only.
 */
describe('documents across gateways', () => {
  test('two gateways, two clients, one document: an edit on one reaches the other', async () => {
    const { gatewayDb } = await getHarness();
    const url = new URL(TEST_URL);
    url.username = GATEWAY_TEST_ROLE.role;
    url.password = GATEWAY_TEST_ROLE.password;
    const secondListen = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    const second = await createGateway({
      db: gatewayDb,
      listenClient: secondListen,
      port: 0,
      webOrigin: 'http://localhost:3000',
    });
    try {
      const owner = await createActor('Owner');
      const other = await createActor('Other');
      const workspace = await createWorkspace(owner);
      await addMember(owner, workspace.id, other, 'MEMBER');
      const created = await request(`/workspaces/${workspace.id}/documents`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Shared' },
      });
      const documentId = created.json().document.id as string;

      const here = await TestClient.connect(owner);
      await here.subscribe(workspace.id);
      await here.openDocument(documentId);
      const there = await TestClient.connect(other, `ws://127.0.0.1:${second.port}/ws`);
      await there.subscribe(workspace.id);
      await there.openDocument(documentId);

      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'written on the first gateway');
      here.sendUpdate(documentId, doc);

      const arrived = await there.waitFor(
        (m): m is Extract<ServerMessage, { type: 'doc.update' }> =>
          m.type === 'doc.update' && m.documentId === documentId,
        5000,
      );
      const received = new Y.Doc();
      Y.applyUpdate(received, new Uint8Array(Buffer.from(arrived.update, 'base64')));
      expect(received.getText('content').toString()).toBe('written on the first gateway');

      here.close();
      there.close();
    } finally {
      await second.close();
      await secondListen.end();
    }
  });
});
