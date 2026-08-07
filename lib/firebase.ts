/**
 * Firebase in the browser: sign-in and analytics, and nothing else.
 *
 * The quiz's data never travels this way. The web SDK has no Firestore handle
 * here on purpose — firestore.rules denies every client read and write, so the
 * only thing the browser can do with Firebase is prove who it is. It hands the
 * resulting ID token to our own API, which verifies it with the Admin SDK and
 * issues a signed session cookie. That is what keeps the answer key and everyone
 * else's score out of reach of a page script.
 *
 * The `NEXT_PUBLIC_FIREBASE_*` values are public by design: they identify the
 * project, they are visible in any Firebase web app, and they are not credentials.
 * The service account, which is one, lives in server-only variables.
 *
 * Everything is imported dynamically and built on first use. The Firebase SDK is
 * ~200 kB of JavaScript that a visitor who never signs in should not pay for, and
 * `analytics` in particular must not be constructed during SSR — it touches
 * `window` on the way up.
 */
import { BASE_PATH } from './basePath';
import type { Analytics } from 'firebase/analytics';
import type { FirebaseApp } from 'firebase/app';
import type { Auth, UserCredential } from 'firebase/auth';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? ''
};

/** False when the build had no web config, so the gate can say so plainly. */
export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

let appPromise: Promise<FirebaseApp> | null = null;

async function app(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = (async () => {
      const { getApp, getApps, initializeApp } = await import('firebase/app');
      // Hot reload in dev re-runs this module; a second initializeApp under the
      // same name throws.
      return getApps().length ? getApp() : initializeApp(config);
    })();
  }
  return appPromise;
}

let authPromise: Promise<Auth> | null = null;

async function auth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = (async () => {
      const { getAuth, setPersistence, browserSessionPersistence } = await import('firebase/auth');
      const instance = getAuth(await app());
      // Session persistence, not local: the server session cookie is the thing
      // that carries the run, and leaving a signed-in Firebase user behind in
      // localStorage on a shared campus machine is how the next person ends up
      // holding someone else's account.
      await setPersistence(instance, browserSessionPersistence).catch(() => undefined);
      return instance;
    })();
  }
  return authPromise;
}

/**
 * Opens the Google popup and returns the ID token for the account chosen.
 *
 * `prompt: 'select_account'` every time, and no auto-select: attempts are one per
 * person, so silently signing someone in with whichever account the browser
 * remembers is the wrong default. `hd` is passed when the deploy restricts a
 * domain — it is a hint that filters the account chooser, not a control; the
 * server re-checks the domain on the token it is handed.
 */
export async function signInWithGoogle(domain?: string): Promise<string> {
  const [{ GoogleAuthProvider, signInWithPopup }, instance] = await Promise.all([
    import('firebase/auth'),
    auth()
  ]);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters(domain ? { prompt: 'select_account', hd: domain } : { prompt: 'select_account' });
  const credential: UserCredential = await signInWithPopup(instance, provider);
  return credential.user.getIdToken();
}

/** Ends the Firebase side of the session. The server cookie is cleared separately. */
export async function signOutFirebase(): Promise<void> {
  const [{ signOut }, instance] = await Promise.all([import('firebase/auth'), auth()]);
  await signOut(instance).catch(() => undefined);
}

// ── Analytics ────────────────────────────────────────────────────────────────

let analyticsPromise: Promise<Analytics | null> | null = null;

async function analytics(): Promise<Analytics | null> {
  if (!analyticsPromise) {
    analyticsPromise = (async () => {
      if (typeof window === 'undefined' || !firebaseConfigured || !config.measurementId) return null;
      const { getAnalytics, isSupported } = await import('firebase/analytics');
      // `isSupported` is not ceremony: it is false in browsers with cookies
      // disabled, in some in-app webviews, and behind privacy extensions, and
      // getAnalytics throws in those.
      return (await isSupported().catch(() => false)) ? getAnalytics(await app()) : null;
    })();
  }
  return analyticsPromise;
}

/**
 * Fire-and-forget event. Never throws and never blocks a click: analytics
 * failing must not be able to stop someone answering a question, so every call
 * site treats this as a side effect with no return value.
 *
 * Names are snake_case because that is what the Firebase console groups on.
 * Nothing identifying is ever passed — no email, no uid, no answer. Section and
 * stage ids are event parameters; who did it is not.
 */
export function track(event: string, params?: Record<string, string | number | boolean>): void {
  void (async () => {
    try {
      const instance = await analytics();
      if (!instance) return;
      const { logEvent } = await import('firebase/analytics');
      logEvent(instance, event, params);
    } catch {
      // Blocked, unsupported, offline. Not a failure anyone needs to hear about.
    }
  })();
}

/** Records a page view for the mounted screen. The app has no route changes to hook. */
export function trackScreen(screen: string): void {
  track('screen_view', { firebase_screen: screen, app_path: BASE_PATH || '/' });
}
