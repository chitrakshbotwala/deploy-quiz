import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { env } from './env';

/**
 * The Firebase Admin SDK, and the only door to Firestore.
 *
 * Everything the quiz stores goes through this file, from a Node process holding
 * a service account. The published security rules (firestore.rules) deny every
 * client read and write, which is what lets the answer key live in the same
 * database as the scores: a signed-in browser cannot read one document, not even
 * its own. The Admin SDK bypasses rules by design, so the API routes are the
 * whole surface, and each of them re-derives what the caller may see.
 *
 * Built on first use and cached on `globalThis`, for two separate reasons:
 * `next build` evaluates these modules while collecting the route table and must
 * not need credentials, and dev-mode hot reload re-evaluates the module on every
 * edit — `initializeApp` twice under the same name throws.
 */
const APP = 'dor-quiz';

function app() {
  // getApps() rather than a module-level flag: the flag is lost on hot reload,
  // the app registry is not.
  if (getApps().some(a => a.name === APP)) return getApp(APP);
  const sa = env.serviceAccount;
  return initializeApp(
    {
      credential: cert({
        projectId: sa.projectId,
        clientEmail: sa.clientEmail,
        privateKey: sa.privateKey
      }),
      projectId: sa.projectId
    },
    APP
  );
}

const DB = Symbol.for('dor-quiz.firestore');
type DbCache = typeof globalThis & { [DB]?: Firestore };

export function fs(): Firestore {
  const cache = globalThis as DbCache;
  if (cache[DB]) return cache[DB];
  const store = getFirestore(app());
  // `undefined` fields are dropped rather than rejected. Half of what is written
  // here is optional (a section with no ip, an unlocked answer with no choice),
  // and the alternative is a `delete obj.x` before every set.
  store.settings({ ignoreUndefinedProperties: true });
  cache[DB] = store;
  return store;
}

export interface Identity {
  /** The Firebase account uid. The identity everything is keyed on. */
  uid: string;
  email: string;
  name: string;
}

export type VerifyFailure =
  | { ok: false; reason: 'invalid-token' }
  | { ok: false; reason: 'unverified-email' }
  | { ok: false; reason: 'wrong-provider' }
  | { ok: false; reason: 'wrong-domain'; domain: string | null };

export type VerifyResult = { ok: true; identity: Identity } | VerifyFailure;

/**
 * Verifies the ID token the browser got from Firebase Auth after a Google
 * sign-in.
 *
 * This is the file the leaderboard's credibility rests on. `verifyIdToken` does
 * the parts that are easy to get wrong by hand: fetches and caches Google's
 * public keys, checks the signature, and rejects a token whose audience is not
 * this project or whose expiry has passed. A hand-rolled decode would skip every
 * one of those and accept a token the caller wrote themselves.
 *
 * Three checks sit on top of the signature:
 *  - the sign-in provider must be google.com, so nobody can enable email/password
 *    or anonymous auth in the console and walk in with a self-served identity;
 *  - the address must be one Google says it verified;
 *  - the domain must be allowed, when the deploy restricts domains at all. It
 *    does not by default any more — see the note on `env.emailDomains` for what
 *    that trades away.
 */
export async function verifyIdToken(idToken: string): Promise<VerifyResult> {
  let claims;
  try {
    claims = await getAuth(app()).verifyIdToken(idToken, true);
  } catch {
    // Bad signature, expired, wrong audience, revoked, malformed — all the same
    // answer to the caller. Distinguishing them would only help someone probing.
    return { ok: false, reason: 'invalid-token' };
  }

  const provider = (claims.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider;
  if (provider !== 'google.com') return { ok: false, reason: 'wrong-provider' };

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (!claims.uid || !email) return { ok: false, reason: 'invalid-token' };
  if (claims.email_verified === false) return { ok: false, reason: 'unverified-email' };

  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : null;
  if (env.emailDomains.length && (!domain || !env.emailDomains.includes(domain))) {
    return { ok: false, reason: 'wrong-domain', domain };
  }

  return {
    ok: true,
    identity: {
      uid: claims.uid,
      email,
      // Workspace accounts effectively always carry a name; fall back to the
      // local part rather than storing an empty string.
      name: String(claims.name ?? email.split('@')[0]).slice(0, 80)
    }
  };
}
