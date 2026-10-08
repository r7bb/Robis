import { type AuthenticatedUser, resolveSession, SESSION_COOKIE } from '@robis/auth';
import {
  type Database,
  findMembership,
  publishPresence,
  subscribeToEvents,
  subscribeToPresence,
} from '@robis/database';
import { Registry } from '@robis/metrics';
import {
  type ClientMessage,
  type DocumentAwareness,
  isUuid,
  type PresenceMessage,
  type ServerEvent,
  type ServerMessage,
} from '@robis/shared';
import type postgres from 'postgres';
import { DocumentRooms, documentInWorkspace } from './documents.ts';
import { PresenceRegistry } from './presence.ts';

/**
 * WebSocket gateway.
 *
 * A separate process from the REST API rather than an upgrade handler bolted
 * onto Fastify. Two reasons: long-lived sockets and short request/response
 * traffic have opposite scaling shapes -- one is bounded by memory and file
 * descriptors, the other by CPU -- and separating them means a deploy of the
 * API does not drop every open connection.
 *
 * It shares the database and the session logic with the API, so there is one
 * definition of who you are and what you may see.
 */

/**
 * The client message kinds, as a set, so a `type` off the wire can be bounded
 * before it becomes a metric label. Anything else counts as `unknown` rather
 * than opening its own time series.
 */
const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set<ClientMessage['type']>([
  'subscribe',
  'location',
  'ping',
  'doc.open',
  'doc.close',
  'doc.update',
  'doc.awareness',
]);

/** How often each instance re-announces its presence entries to peers. Must be
 * comfortably below PRESENCE_TTL_MS so peers never expire a live connection. */
const REANNOUNCE_INTERVAL_MS = 15_000;
const SWEEP_INTERVAL_MS = 10_000;

type SocketData = {
  connectionId: string;
  userId: string;
  name: string;
  /** Null until the client sends `subscribe` and passes the membership check. */
  workspaceId: string | null;
  location: string | null;
  /** Documents this connection has open, so close can release all of them. */
  openDocuments: Set<string>;
};

export type GatewayOptions = {
  db: Database;
  /** Raw client: LISTEN holds a dedicated connection and must bypass the pool. */
  listenClient: postgres.Sql;
  port?: number;
  /** Origin allowed to open a socket. */
  webOrigin?: string;
  instanceId?: string;
};

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }

  return null;
}

export async function createGateway(options: GatewayOptions) {
  const { db, listenClient, port = 4001, webOrigin = 'http://localhost:3000' } = options;
  const instanceId = options.instanceId ?? crypto.randomUUID();

  const presence = new PresenceRegistry();
  const rooms = new DocumentRooms(db);
  const sockets = new Set<Bun.ServerWebSocket<SocketData>>();

  /*
   * Gateway metrics.
   *
   * The counters that matter here are the ones the API cannot see: fan-out
   * volume, and how many sockets are actually open. Connection count is a
   * collector rather than a tracked gauge because the set is already the
   * truth -- incrementing a parallel counter in `open` and `close` is one
   * missed path away from drifting from reality forever.
   *
   * No label carries a workspace id: the number of workspaces is unbounded,
   * and per-tenant traffic is not something a metrics endpoint should expose.
   */
  const registry = new Registry();
  registry.gauge('robis_ws_connections', 'Open WebSocket connections.').collect(() => sockets.size);
  registry
    .gauge('robis_ws_presence_entries', 'Presence entries held.')
    .collect(() => presence.size);
  registry.gauge('robis_ws_document_rooms', 'Document rooms in memory.').collect(() => rooms.size);

  const messagesIn = registry.counter(
    'robis_ws_messages_received_total',
    'Client messages handled, by type.',
    ['type'],
  );
  const eventsOut = registry.counter(
    'robis_ws_event_deliveries_total',
    'Individual event deliveries to sockets, by event type.',
    ['type'],
  );
  const upgrades = registry.counter(
    'robis_ws_upgrades_total',
    'WebSocket upgrade attempts, by outcome.',
    ['outcome'],
  );

  /** Tail of the in-flight handler chain for each connection. */
  const pendingWork = new WeakMap<Bun.ServerWebSocket<SocketData>, Promise<void>>();

  function send(socket: Bun.ServerWebSocket<SocketData>, message: ServerMessage) {
    socket.send(JSON.stringify(message));
  }

  /** Push the current presence roster for a workspace to everyone in it. */
  function broadcastPresence(workspaceId: string) {
    const users = presence.forWorkspace(workspaceId);
    const message = JSON.stringify({
      type: 'presence',
      workspaceId,
      users,
    } satisfies ServerMessage);

    for (const socket of sockets) {
      if (socket.data.workspaceId === workspaceId) socket.send(message);
    }
  }

  function broadcastEvent(event: ServerEvent) {
    const message = JSON.stringify({ type: 'event', event } satisfies ServerMessage);

    let delivered = 0;
    for (const socket of sockets) {
      // Membership was verified at subscribe time, and revocation closes the
      // socket, so workspace id is sufficient to scope the fan-out here.
      if (socket.data.workspaceId === event.workspaceId) {
        socket.send(message);
        delivered++;
      }
    }

    // Counts deliveries, not events: one write reaching fifty sockets is the
    // quantity that describes fan-out cost, and dividing by the event count
    // gives the average audience.
    if (delivered > 0) eventsOut.inc({ type: event.type }, delivered);
  }

  /** The plain-HTTP side of the gateway: liveness and scraping, no upgrade. */
  function serveOperationalEndpoint(pathname: string): Response | null {
    if (pathname === '/health') {
      return Response.json({
        status: 'ok',
        instanceId,
        connections: sockets.size,
        presence: presence.size,
        documentRooms: rooms.size,
      });
    }

    if (pathname === '/metrics') {
      return new Response(registry.render(), {
        headers: { 'content-type': Registry.CONTENT_TYPE },
      });
    }

    return null;
  }

  /**
   * Everything that has to hold before a socket is opened.
   *
   * Returns the user on success and a `Response` to send back otherwise, so
   * each refusal is counted at the point it is decided rather than inferred
   * later from a status code.
   */
  async function authenticateUpgrade(request: Request): Promise<AuthenticatedUser | Response> {
    // Browsers do not enforce same-origin on WebSockets, so the gateway has
    // to check Origin itself; otherwise any site could open an authenticated
    // socket using the visitor's cookie.
    const origin = request.headers.get('origin');
    if (origin && origin !== webOrigin) {
      upgrades.inc({ outcome: 'forbidden_origin' });
      return new Response('Forbidden origin', { status: 403 });
    }

    const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
    if (!token) {
      upgrades.inc({ outcome: 'no_session' });
      return new Response('Unauthorized', { status: 401 });
    }

    const user = await resolveSession(db, token);
    if (!user) {
      // Distinguished from `no_session` on purpose: a cookie that no longer
      // resolves is an expiry or a revocation, which is a different story
      // from a client that never had one.
      upgrades.inc({ outcome: 'invalid_session' });
      return new Response('Unauthorized', { status: 401 });
    }

    return user;
  }

  const server = Bun.serve<SocketData>({
    port,

    async fetch(request, srv) {
      const url = new URL(request.url);

      const operational = serveOperationalEndpoint(url.pathname);
      if (operational) return operational;

      if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });

      const user = await authenticateUpgrade(request);
      if (user instanceof Response) return user;

      const upgraded = srv.upgrade(request, {
        data: {
          connectionId: crypto.randomUUID(),
          userId: user.id,
          name: user.name,
          workspaceId: null,
          location: null,
          openDocuments: new Set<string>(),
        } satisfies SocketData,
      });

      upgrades.inc({ outcome: upgraded ? 'accepted' : 'failed' });
      return upgraded ? undefined : new Response('Upgrade failed', { status: 400 });
    },

    websocket: {
      open(socket) {
        sockets.add(socket);
      },

      message(socket, raw) {
        let message: ClientMessage;
        try {
          message = JSON.parse(String(raw)) as ClientMessage;
        } catch {
          messagesIn.inc({ type: 'malformed' });
          return send(socket, { type: 'error', message: 'Malformed message' });
        }

        // `type` comes off the wire, so it is bounded to the known kinds
        // before becoming a label. An attacker sending `{"type":"<random>"}`
        // in a loop would otherwise grow the registry without limit.
        messagesIn.inc({ type: CLIENT_MESSAGE_TYPES.has(message.type) ? message.type : 'unknown' });

        /*
         * Handle one message at a time per connection.
         *
         * Several handlers are async, and the runtime does not wait for one to
         * finish before delivering the next. A client that sends `subscribe`
         * immediately followed by `doc.open` would otherwise race: the second
         * runs while the first is still awaiting its membership lookup, sees no
         * workspace on the socket, and is rejected. Chaining keeps the observable
         * order the same as the wire order.
         */
        const queue = pendingWork.get(socket) ?? Promise.resolve();

        const next = queue
          .then(() => dispatch(socket, message))
          .catch((error) => {
            console.error('gateway: message handler failed', error);
          });

        pendingWork.set(socket, next);
      },

      async close(socket) {
        sockets.delete(socket);

        // Let queued handlers finish before releasing rooms, so an update still
        // being applied is not dropped on the floor.
        await pendingWork.get(socket)?.catch(() => {});

        const { workspaceId, connectionId, openDocuments } = socket.data;

        // Leaving the last seat in a room flushes its pending writes, so a
        // closed tab does not strand unsaved edits.
        for (const documentId of openDocuments) {
          const room = await rooms.leave(documentId, connectionId);
          if (room) broadcastAwareness(documentId);
        }
        openDocuments.clear();

        if (!workspaceId) return;

        presence.remove(connectionId);
        broadcastPresence(workspaceId);
        await publishPresence(db, { kind: 'remove', instanceId, connectionId, workspaceId });
      },
    },
  });

  /** One handler per message type, so the switch stays flat as kinds are added. */
  function dispatch(socket: Bun.ServerWebSocket<SocketData>, message: ClientMessage) {
    switch (message.type) {
      case 'subscribe':
        return handleSubscribe(socket, message.workspaceId);
      case 'location':
        return handleLocation(socket, message.location);
      case 'ping':
        return handlePing(socket);
      case 'doc.open':
        return handleDocOpen(socket, message.documentId);
      case 'doc.close':
        return handleDocClose(socket, message.documentId);
      case 'doc.update':
        return handleDocUpdate(socket, message.documentId, message.update);
      case 'doc.awareness':
        return handleDocAwareness(socket, message.documentId, message.state);
    }
  }

  /**
   * Join a workspace feed.
   *
   * Authorization happens here rather than at connect time: the cookie proves
   * who you are, membership proves what you may watch.
   */
  async function handleSubscribe(socket: Bun.ServerWebSocket<SocketData>, workspaceId: string) {
    const membership = await findMembership(db, workspaceId, socket.data.userId);

    if (!membership) {
      return send(socket, { type: 'error', message: 'Not a member of that workspace' });
    }

    const previous = socket.data.workspaceId;
    socket.data.workspaceId = workspaceId;
    socket.data.location = null;

    await announce(socket);
    send(socket, { type: 'ready', userId: socket.data.userId, workspaceId });

    broadcastPresence(workspaceId);
    // Leaving one workspace for another changes both rosters.
    if (previous && previous !== workspaceId) broadcastPresence(previous);
  }

  async function handleLocation(socket: Bun.ServerWebSocket<SocketData>, location: string | null) {
    const { workspaceId } = socket.data;
    if (!workspaceId) return;

    socket.data.location = location;
    await announce(socket);
    broadcastPresence(workspaceId);
  }

  /** Refreshes this connection's TTL locally and on peers. */
  async function handlePing(socket: Bun.ServerWebSocket<SocketData>) {
    if (socket.data.workspaceId) await announce(socket);
  }

  /** Push the current cursor roster for a document to everyone editing it. */
  function broadcastAwareness(documentId: string) {
    const room = rooms.get(documentId);
    if (!room) return;

    const message = JSON.stringify({
      type: 'doc.awareness',
      documentId,
      users: room.awarenessList(),
    } satisfies ServerMessage);

    for (const socket of sockets) {
      if (socket.data.openDocuments.has(documentId)) socket.send(message);
    }
  }

  /** Robis a document update to every other editor. The sender already has it. */
  function broadcastDocUpdate(documentId: string, update: string, from: string) {
    const message = JSON.stringify({
      type: 'doc.update',
      documentId,
      update,
      actorId: from,
    } satisfies ServerMessage);

    for (const socket of sockets) {
      if (socket.data.connectionId === from) continue;
      if (socket.data.openDocuments.has(documentId)) socket.send(message);
    }
  }

  /**
   * Join a document room.
   *
   * The document must live in the workspace this socket is subscribed to --
   * membership was checked at subscribe time, and this ties the document to
   * that same tenant so a document id from elsewhere is not reachable.
   */
  async function handleDocOpen(socket: Bun.ServerWebSocket<SocketData>, documentId: string) {
    const { workspaceId } = socket.data;
    if (!workspaceId) {
      return send(socket, { type: 'error', message: 'Subscribe to a workspace first' });
    }

    if (!isUuid(documentId) || !(await documentInWorkspace(db, documentId, workspaceId))) {
      return send(socket, { type: 'error', message: 'Document not found' });
    }

    const room = await rooms.join(documentId, {
      connectionId: socket.data.connectionId,
      userId: socket.data.userId,
      name: socket.data.name,
      awareness: { cursor: null },
    });

    socket.data.openDocuments.add(documentId);

    // One catch-up message rather than a replay of the update log.
    send(socket, {
      type: 'doc.sync',
      documentId,
      update: Buffer.from(room.fullState()).toString('base64'),
    });

    broadcastAwareness(documentId);
  }

  async function handleDocClose(socket: Bun.ServerWebSocket<SocketData>, documentId: string) {
    if (!socket.data.openDocuments.delete(documentId)) return;

    const room = await rooms.leave(documentId, socket.data.connectionId);
    if (room) broadcastAwareness(documentId);
  }

  function handleDocUpdate(
    socket: Bun.ServerWebSocket<SocketData>,
    documentId: string,
    encoded: string,
  ) {
    if (!socket.data.openDocuments.has(documentId)) return;

    const room = rooms.get(documentId);
    if (!room) return;

    let update: Uint8Array;
    try {
      update = new Uint8Array(Buffer.from(encoded, 'base64'));
    } catch {
      return send(socket, { type: 'error', message: 'Malformed document update' });
    }

    // Nothing new means nothing to robis -- Yjs tolerates duplicates, but the
    // other editors should not pay for them.
    if (room.applyUpdate(update)) {
      broadcastDocUpdate(documentId, encoded, socket.data.connectionId);
    }
  }

  function handleDocAwareness(
    socket: Bun.ServerWebSocket<SocketData>,
    documentId: string,
    state: DocumentAwareness,
  ) {
    const room = rooms.get(documentId);
    const participant = room?.participants.get(socket.data.connectionId);
    if (!participant) return;

    // Cursor positions are ephemeral by definition; they are never persisted.
    participant.awareness = state;
    broadcastAwareness(documentId);
  }

  /** Record a connection locally and tell peers about it. */
  async function announce(socket: Bun.ServerWebSocket<SocketData>) {
    const { connectionId, userId, name, workspaceId, location } = socket.data;
    if (!workspaceId) return;

    presence.upsert({
      connectionId,
      instanceId,
      workspaceId,
      userId,
      name,
      location,
      lastSeenAt: Date.now(),
    });

    await publishPresence(db, {
      kind: 'upsert',
      instanceId,
      connectionId,
      workspaceId,
      userId,
      name,
      location,
    });
  }

  const unsubscribeEvents = await subscribeToEvents(listenClient, broadcastEvent);

  /** Apply a peer's presence delta and rebroadcast any roster it changed. */
  function applyPresenceGossip(message: PresenceMessage) {
    // Our own gossip is already applied locally.
    if (message.instanceId === instanceId) return;

    for (const workspaceId of presence.apply(message)) broadcastPresence(workspaceId);
  }

  const unsubscribePresence = await subscribeToPresence(listenClient, applyPresenceGossip);

  const reannounce = setInterval(() => {
    for (const socket of sockets) void announce(socket);
  }, REANNOUNCE_INTERVAL_MS);

  const sweeper = setInterval(() => {
    for (const workspaceId of presence.sweep()) broadcastPresence(workspaceId);
  }, SWEEP_INTERVAL_MS);

  return {
    server,
    port: server.port,
    instanceId,
    presence,

    async close() {
      clearInterval(reannounce);
      clearInterval(sweeper);

      // Tell peers to drop our entries immediately rather than waiting for TTL.
      await publishPresence(db, { kind: 'bye', instanceId }).catch(() => {});
      await unsubscribeEvents().catch(() => {});
      await unsubscribePresence().catch(() => {});

      for (const socket of sockets) socket.close(1001, 'Server shutting down');
      sockets.clear();

      // Persist anything still debounced before the process goes away.
      await rooms.closeAll();

      await server.stop(true);
    },
  };
}
