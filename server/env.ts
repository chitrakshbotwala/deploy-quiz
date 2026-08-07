import { BASE_PATH } from '@/lib/basePath';

/**
 * Environment, read on access and validated at boot by `assertEnv()`.
 *
 * The fields are getters rather than plain values on purpose. Next imports every
 * route module during `next build` to collect the route table, so a top-level
 * `required('DATABASE_URL')` would make the build itself demand a database — and
 * the build runs on machines that have none. Deferring the read to first access
 * keeps the build honest while `assertEnv()`, called from `instrumentation.ts`,
 * still fails a real server start immediately rather than at the first request.
 *
 * None of these names carry `NEXT_PUBLIC_`, and none of them ever should: Next
 * inlines every `NEXT_PUBLIC_*` variable into the client bundle, so a
 * `NEXT_PUBLIC_DATABASE_URL` would ship the database password to every visitor.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
  /**
   * OAuth 2.0 Web client id from the GCP console. Public by design — it is
   * served to the browser so the sign-in button can render, and it is safe
   * there. There is deliberately no client secret: the ID-token flow does not
   * use one, and adding the authorization-code flow only to obtain a secret we
   * have no use for would be strictly more to get wrong.
   *
   * Required, not optional. Sign-in is the only way into the quiz, so a deploy
   * missing this should fail at boot rather than serve a dead button.
   */
  get googleClientId(): string {
    return required('GOOGLE_CLIENT_ID');
  },
  /**
   * HMAC key for the run cookie. Without it a visitor could hand-write a cookie
   * naming someone else's run id and answer on their behalf.
   * Generate with: openssl rand -hex 32
   */
  get cookieSecret(): string {
    return required('RUN_COOKIE_SECRET');
  },
  get isProd(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /**
   * Workspace domains allowed to sign in, compared against the `hd` claim of a
   * Google-signed ID token. Comma-separated.
   *
   * Defaults to kiit.ac.in rather than to "anything": a deploy that forgot the
   * variable would otherwise let any personal Gmail account in, and unlimited
   * Gmail accounts means unlimited attempts. Set it to an empty string to allow
   * any Google account on purpose.
   */
  get emailDomains(): string[] {
    return (process.env.QUIZ_EMAIL_DOMAINS ?? 'kiit.ac.in')
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
   * Path the run cookie is scoped to. This app shares gdgkiit.in with whatever
   * else is served there, so the cookie is pinned to /dor/quiz instead of `/`
   * and is never attached to a request that has no business seeing it.
   */
  get cookiePath(): string {
    return BASE_PATH || '/';
  }
};

/** Boot guard. Touches every required variable so a bad deploy dies at start. */
export function assertEnv(): void {
  void env.databaseUrl;
  void env.googleClientId;
  void env.cookieSecret;
}
