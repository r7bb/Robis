/**
 * `bun run mail:start`: a local inbox for development.
 *
 * SMTP on 127.0.0.1:1025, so the worker can send real mail with
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=1025
 * and an inbox at http://127.0.0.1:8025 (JSON at /messages). Messages live
 * in memory and are gone when this stops. Development only: it accepts mail
 * from anyone on this machine, with no password.
 */
import { type SunkMessage, startMailSink } from './sink-server.ts';

const SMTP_PORT = Number(process.env.MAIL_SINK_SMTP_PORT ?? 1025);
const HTTP_PORT = Number(process.env.MAIL_SINK_HTTP_PORT ?? 8025);

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

/** Escaped first, then links made clickable, so message text cannot inject markup. */
const linkify = (text: string) =>
  escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);

function renderMessage(message: SunkMessage) {
  return `<article>
  <header>
    <h2>${escapeHtml(message.subject || '(no subject)')}</h2>
    <p>To ${escapeHtml(message.to.join(', '))} &middot; from ${escapeHtml(message.from)} &middot;
    <time datetime="${message.receivedAt}">${new Date(message.receivedAt).toLocaleTimeString()}</time></p>
  </header>
  <pre>${linkify(message.text)}</pre>
</article>`;
}

function renderInbox(messages: SunkMessage[]) {
  const list = [...messages].reverse().map(renderMessage).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Robis mail sink</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --card: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #f4f4f5; --muted: #a1a1aa; --line: #27272a; --card: #18181b; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  main > p { color: var(--muted); margin: 0 0 24px; }
  article { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; }
  h2 { font-size: 16px; margin: 0; }
  header p { color: var(--muted); font-size: 13px; margin: 2px 0 12px; }
  pre { white-space: pre-wrap; word-break: break-word; font: 14px/1.6 ui-monospace, monospace; margin: 0; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>Mail sink</h1>
  <p>${messages.length} message${messages.length === 1 ? '' : 's'} caught on 127.0.0.1:${SMTP_PORT}. Nothing here was sent anywhere. Refreshes every 5 seconds.</p>
  ${list || '<p>Nothing yet. Ask for a password reset to see one arrive.</p>'}
</main>
</body>
</html>`;
}

const sink = await startMailSink({ port: SMTP_PORT });

Bun.serve({
  hostname: '127.0.0.1',
  port: HTTP_PORT,
  fetch(request) {
    // Only this machine, by name too: a page served elsewhere that rebinds
    // its DNS to 127.0.0.1 arrives with its own Host and is refused.
    const host = request.headers.get('host');
    if (host !== `127.0.0.1:${HTTP_PORT}` && host !== `localhost:${HTTP_PORT}`) {
      return new Response('Forbidden', { status: 403 });
    }
    const { pathname } = new URL(request.url);
    if (pathname === '/messages') return Response.json({ messages: sink.messages });
    if (pathname === '/') {
      return new Response(renderInbox(sink.messages), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});

process.stdout.write(
  `Mail sink: SMTP on 127.0.0.1:${sink.port}, inbox at http://127.0.0.1:${HTTP_PORT}\n`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await sink.close();
    process.exit(0);
  });
}
