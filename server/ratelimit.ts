import type { Context } from 'hono';
import { env } from './env';

/**
 * Per-IP fixed-window limiter, in process memory.
 *
 * In memory is the right call here and not a shortcut: this is a single Node
 * process on a single box, so a Map is exactly as authoritative as a Redis key
 * would be, and it costs no network hop. It resets on deploy, which for a
 * one-evening event is acceptable.
 *
 * This guards signup only. The per-question routes are already bounded by the
 * database — a run can answer each question exactly once, forever.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function clientIp(c: Context): string {
  if (env.trustProxy) {
    // Caddy appends the real peer, so the LAST entry is the one it observed and
    // the only one a client cannot forge.
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}

/** Returns true when the caller is still within budget. */
export function take(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hit = windows.get(key);
  if (!hit || now >= hit.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (hit.count >= limit) return false;
  hit.count += 1;
  return true;
}

/** Drops expired windows so a long-running process does not grow a Map forever. */
export function sweep(): void {
  const now = Date.now();
  for (const [key, hit] of windows) if (now >= hit.resetAt) windows.delete(key);
}
