import { OAuth2Client } from 'google-auth-library';
import { env } from './env';

/**
 * Verifies the ID token the "Sign in with Google" button hands the page.
 *
 * This file is the reason the leaderboard can be trusted. The old email form
 * checked that a typed string ended in "@kiit.ac.in", which proves nothing —
 * anyone could type a classmate's address and burn the one run that classmate
 * was ever going to get. What arrives here instead is a JWT that Google signed,
 * and the `hd` claim inside it is Google asserting that the account belongs to
 * the kiit.ac.in Workspace. That cannot be typed, guessed, or enumerated.
 *
 * `verifyIdToken` does the parts that are easy to get wrong by hand: fetches and
 * caches Google's JWKS, checks the signature, and rejects a token whose `aud` is
 * not our client id or whose `iss`/`exp` are wrong. A hand-rolled `jwt.decode`
 * would skip every one of those and accept a token the caller wrote themselves.
 */
/**
 * Built on first verification, not at import: Next evaluates this module while
 * collecting the route table during `next build`, and the client id is a
 * deployment secret that a build machine has no reason to hold. Cached after,
 * because `OAuth2Client` keeps the fetched JWKS and throwing that away per
 * request would mean a network round-trip on every sign-in.
 */
let client: OAuth2Client | null = null;

function oauth(): OAuth2Client {
  if (!client) client = new OAuth2Client(env.googleClientId);
  return client;
}

export interface GoogleIdentity {
  /** Google's stable per-account id. The identity we key participants on. */
  sub: string;
  email: string;
  name: string;
  /** The Workspace domain. Absent entirely on personal @gmail.com accounts. */
  hd: string;
}

export type VerifyFailure =
  | { ok: false; reason: 'invalid-token' }
  | { ok: false; reason: 'unverified-email' }
  | { ok: false; reason: 'wrong-domain'; hd: string | null };

export type VerifyResult = { ok: true; identity: GoogleIdentity } | VerifyFailure;

export async function verifyGoogleCredential(credential: string): Promise<VerifyResult> {
  let payload;
  try {
    const ticket = await oauth().verifyIdToken({ idToken: credential, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    // Bad signature, expired, wrong audience, malformed — all the same answer to
    // the caller. Distinguishing them would only help someone probing.
    return { ok: false, reason: 'invalid-token' };
  }
  if (!payload?.sub || !payload.email) return { ok: false, reason: 'invalid-token' };

  // Google sets this false for addresses it has not confirmed. Rare on Workspace
  // accounts, but it is the difference between "Google says this is their
  // address" and "someone told Google this is their address".
  if (payload.email_verified === false) return { ok: false, reason: 'unverified-email' };

  // The whole point. `hd` is present only on Workspace accounts, so a personal
  // gmail lands here with `hd` undefined and is turned away — which is exactly
  // what we want, and is not something a string check on the address could do.
  const hd = payload.hd ?? null;
  if (env.emailDomains.length && (!hd || !env.emailDomains.includes(hd.toLowerCase()))) {
    return { ok: false, reason: 'wrong-domain', hd };
  }

  return {
    ok: true,
    identity: {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      // Workspace accounts effectively always carry a name; fall back to the
      // local part rather than writing an empty string into a not-null column.
      name: (payload.name ?? payload.email.split('@')[0]).slice(0, 80),
      hd: hd ?? ''
    }
  };
}
