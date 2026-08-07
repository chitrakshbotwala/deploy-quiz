import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { api } from '@/server/routes';
import { BASE_PATH } from '@/lib/basePath';

/**
 * The whole API, behind one catch-all.
 *
 * The routes are a Hono app rather than a file per endpoint under app/api/,
 * because the run is a single stateful thing: five routes that share a cookie
 * reader, a rate limiter, an error shape, and a transaction helper. Splitting
 * them across five `route.ts` files would scatter that and buy nothing — Next's
 * router would be doing work Hono already does.
 *
 * `nodejs` is not the default here by accident: `pg` opens TCP sockets and
 * `node:crypto` signs the cookie, neither of which exists on the edge runtime.
 *
 * `force-dynamic` because every one of these reads a cookie and hits Postgres.
 * Without it Next may try to prerender the handler at build time, which would
 * demand a database during `next build`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const app = new Hono();

// Mounted twice on purpose. Next's `basePath` is applied to the URL the browser
// requests, and whether the prefix survives into `request.url` by the time a
// route handler sees it is an implementation detail that has changed across
// releases. Registering both spellings makes the routing correct either way, at
// the cost of one extra entry in a router that has five.
app.route('/api', api);
if (BASE_PATH) app.route(`${BASE_PATH}/api`, api);

app.onError((err, c) => {
  console.error('[api] unhandled', err);
  return c.json({ error: 'server-error', message: 'Something broke on our side.' }, 500);
});

export const GET = handle(app);
export const POST = handle(app);
