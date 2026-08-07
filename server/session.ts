import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { env } from './env';

/**
 * The run cookie.
 *
 * A run id on its own would be a bearer token that anyone can guess-or-copy into
 * their own jar, so the cookie carries `<runId>.<hmac>` and the server refuses
 * any value whose signature it did not produce. httpOnly keeps it out of reach
 * of page scripts; SameSite=Lax is enough because every write here is a
 * same-origin fetch from the quiz page itself.
 *
 * `path` is the app's base path rather than `/`. gdgkiit.in is not this app's
 * domain — the quiz is one wing of it — so scoping the cookie keeps it off every
 * request that has nothing to do with a run.
 */
const COOKIE = 'gdg_run';
const MAX_AGE = 60 * 60 * 6; // A run is one sitting. Six hours is generous.

function sign(runId: string): string {
  return createHmac('sha256', env.cookieSecret).update(runId).digest('base64url');
}

export function issueRunCookie(c: Context, runId: string): void {
  setCookie(c, COOKIE, `${runId}.${sign(runId)}`, {
    httpOnly: true,
    sameSite: 'Lax',
    // Only over TLS in production. Left off in dev so plain
    // http://localhost:3000 can carry it.
    secure: env.isProd,
    path: env.cookiePath,
    maxAge: MAX_AGE
  });
}

export function clearRunCookie(c: Context): void {
  setCookie(c, COOKIE, '', {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.isProd,
    path: env.cookiePath,
    maxAge: 0
  });
}

/** Returns the run id only if the cookie carries a signature we produced. */
export function readRunId(c: Context): string | null {
  const raw = getCookie(c, COOKIE);
  if (!raw) return null;
  const cut = raw.lastIndexOf('.');
  if (cut <= 0) return null;
  const runId = raw.slice(0, cut);
  const given = Buffer.from(raw.slice(cut + 1));
  const want = Buffer.from(sign(runId));
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return runId;
}
