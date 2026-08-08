import { BASE_PATH } from '@/lib/basePath';

/**
 * Environment, read on access and validated at boot by `assertEnv()`.
 *
 * The fields are getters rather than plain values on purpose. Next imports every
 * route module during `next build` to collect the route table, so a top-level
 * `required('FIREBASE_PRIVATE_KEY')` would make the build itself demand a service
 * account — and the build runs on machines that have none. Deferring the read to
 * first access keeps the build honest while `assertEnv()`, called from
 * `instrumentation.ts`, still fails a real server start immediately rather than at
 * the first request.
 *
 * None of these names carry `NEXT_PUBLIC_`, and none of them ever should: Next
 * inlines every `NEXT_PUBLIC_*` variable into the client bundle, so a
 * `NEXT_PUBLIC_FIREBASE_PRIVATE_KEY` would ship the service account to every
 * visitor. The Firebase *web* config is a separate, deliberately public set of
 * values and lives in lib/firebase.ts.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export const env = {
  /**
   * The Firebase project the Admin SDK talks to, and the audience an ID token
   * must carry. Falls back to the public web-config project id so a deploy cannot
   * end up verifying tokens for one project while writing data to another.
   */
  get firebaseProjectId(): string {
    const id = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!id) throw new Error('missing required env var FIREBASE_PROJECT_ID');
    return id;
  },
  /**
   * Service-account credentials for the Admin SDK. Firestore writes are
   * authenticated, so unlike plain token verification this cannot be skipped.
   *
   * Two accepted spellings, because the two places this runs want different
   * things: `FIREBASE_SERVICE_ACCOUNT` (the whole JSON, one line — what a
   * systemd EnvironmentFile can hold) or the three fields separately. The
   * private key may carry literal `\n` escapes, which is how it survives being
   * pasted into an env file; they are unescaped here.
   */
  get serviceAccount(): ServiceAccount {
    const blob = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (blob) {
      let parsed: { project_id?: string; client_email?: string; private_key?: string };
      try {
        parsed = JSON.parse(blob);
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
      }
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key');
      }
      return {
        projectId: parsed.project_id ?? this.firebaseProjectId,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, '\n')
      };
    }
    return {
      projectId: this.firebaseProjectId,
      clientEmail: required('FIREBASE_CLIENT_EMAIL'),
      privateKey: required('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n')
    };
  },
  /**
   * HMAC key for the session and admin cookies. Without it a visitor could
   * hand-write a cookie naming someone else's account, or claiming to be an
   * admin. Generate with: openssl rand -hex 32
   */
  get cookieSecret(): string {
    return required('SESSION_COOKIE_SECRET');
  },
  /**
   * The single password that opens the leaderboard. Required, with no default:
   * a deploy that forgets it must fail at boot rather than serve an admin area
   * that anything can walk into.
   */
  get adminPassword(): string {
    return required('ADMIN_PASSWORD');
  },
  get isProd(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /**
   * EmailJS, for telling the finalists. All four are optional together: unset, the
   * admin panel shows the feature as unconfigured instead of the server refusing to
   * boot over a button nobody may press.
   *
   * `privateKey` is the one that must never carry a NEXT_PUBLIC_ prefix. EmailJS
   * browser sends authenticate with the public key alone, so a private key in the
   * bundle would let anyone who loaded the page send mail as the event for as long
   * as the key lived.
   */
  get emailjs(): { serviceId: string; templateId: string; publicKey: string; privateKey: string } {
    return {
      serviceId: process.env.EMAILJS_SERVICE_ID ?? '',
      templateId: process.env.EMAILJS_TEMPLATE_ID ?? '',
      publicKey: process.env.EMAILJS_PUBLIC_KEY ?? '',
      privateKey: process.env.EMAILJS_PRIVATE_KEY ?? ''
    };
  },
  /**
   * Email domains allowed to sign in. Checked against the verified address on
   * the Firebase ID token, which for a Google-provider sign-in is Google's own
   * assertion rather than anything the visitor typed.
   *
   * Empty by default, which means ANY Google account is accepted — this is the
   * event's own decision and not an oversight. What it costs is worth writing
   * down: attempts are one per account, and Google accounts are free and
   * unlimited, so a determined participant can have as many attempts as they are
   * willing to make addresses for. Sign-in is not rate limited either, so the
   * only defence that remains is that each new account starts from zero with the
   * same ten-second clock — nothing carries over. Set this to a comma-separated
   * domain list to get the old guarantee back.
   */
  get emailDomains(): string[] {
    return (process.env.QUIZ_EMAIL_DOMAINS ?? '')
      .split(',')
      .map(d => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
  },
  /**
   * Trust `X-Forwarded-For` for the client IP. True behind Caddy, false if the
   * process is ever exposed directly — otherwise anyone can forge the header and
   * walk straight through the per-IP rate limit.
   */
  get trustProxy(): boolean {
    return process.env.TRUST_PROXY !== 'false';
  },
  /**
   * Path the cookies are scoped to. This app shares gdgkiit.in with whatever
   * else is served there, so they are pinned to /dor/quiz instead of `/` and are
   * never attached to a request that has no business seeing them.
   */
  get cookiePath(): string {
    return BASE_PATH || '/';
  }
};

/** Boot guard. Touches every required variable so a bad deploy dies at start. */
export function assertEnv(): void {
  void env.firebaseProjectId;
  void env.serviceAccount;
  void env.cookieSecret;
  void env.adminPassword;
}
