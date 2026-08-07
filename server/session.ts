import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { env } from './env';

/**
 * Two cookies, both signed, neither readable by page scripts.
 *
 * `gdg_uid` carries the Firebase uid of whoever signed in. It exists so the
 * browser does not have to hold an ID token and re-prove itself on every pick:
 * the token is verified once, at /auth/login, and the uid it yielded is then
 * carried in a value the server signed. A bare uid would be a bearer token
 * anyone could type — uids are not secret and appear in the console — so the
 * cookie is `<uid>.<hmac>` and the server refuses any value whose signature it
 * did not produce.
 *
 * `gdg_admin` is the same construction over an issue timestamp, so an admin
 * session can age out on its own without anything to store.
 *
 * `path` is the app's base path rather than `/`. gdgkiit.in is not this app's
 * domain — the quiz is one wing of it — so scoping the cookies keeps them off
 * every request that has nothing to do with the quiz.
 */
const SESSION = 'gdg_uid';
const ADMIN = 'gdg_admin';

/** A quiz session spans three sections across an evening. */
const SESSION_MAX_AGE = 60 * 60 * 12;
/** An admin session is one sitting at the board, and it is the keys to the kingdom. */
const ADMIN_MAX_AGE = 60 * 60 * 4;

function sign(value: string): string {
  return createHmac('sha256', env.cookieSecret).update(value).digest('base64url');
}

/** Constant-time compare of a presented signature against the one we would make. */
function verify(value: string, presented: string): boolean {
  const given = Buffer.from(presented);
  const want = Buffer.from(sign(value));
  // Length check first: timingSafeEqual throws on a length mismatch.
  return given.length === want.length && timingSafeEqual(given, want);
}

function read(c: Context, name: string): string | null {
  const raw = getCookie(c, name);
  if (!raw) return null;
  const cut = raw.lastIndexOf('.');
  if (cut <= 0) return null;
  const value = raw.slice(0, cut);
  return verify(value, raw.slice(cut + 1)) ? value : null;
}

function write(c: Context, name: string, value: string, maxAge: number): void {
  setCookie(c, name, value ? `${value}.${sign(value)}` : '', {
    httpOnly: true,
    sameSite: 'Lax',
    // Only over TLS in production. Left off in dev so plain
    // http://localhost:3000 can carry it.
    secure: env.isProd,
    path: env.cookiePath,
    maxAge
  });
}

export function issueSession(c: Context, uid: string): void {
  write(c, SESSION, uid, SESSION_MAX_AGE);
}

export function clearSession(c: Context): void {
  write(c, SESSION, '', 0);
}

/** The signed-in uid, or null. The only way a route learns who is calling. */
export function readUid(c: Context): string | null {
  return read(c, SESSION);
}

export function issueAdmin(c: Context): void {
  write(c, ADMIN, String(Date.now()), ADMIN_MAX_AGE);
}

export function clearAdmin(c: Context): void {
  write(c, ADMIN, '', 0);
}

/**
 * True only for a signature we produced over a timestamp inside the window.
 * The age check is here rather than left to the cookie's own `maxAge`, which the
 * browser is free to ignore and an attacker replaying a captured cookie
 * certainly will.
 */
export function isAdmin(c: Context): boolean {
  const issued = read(c, ADMIN);
  if (!issued) return false;
  const at = Number(issued);
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < ADMIN_MAX_AGE * 1000;
}
