/**
 * Boot. Next calls `register()` once per server process, before the first
 * request.
 *
 * Two things have to happen here and nowhere else:
 *   - the environment is validated, so a deploy missing the service account or
 *     the admin password dies at start rather than at whichever request first
 *     tries to read Firestore;
 *   - the question files are parsed and checked, so a half-edited JSON file fails
 *     while someone is watching instead of mid-event, at the moment a participant
 *     reaches that question.
 *
 * There are no migrations to run any more: Firestore has no schema to converge
 * on, and the document ids that enforce one-attempt-per-person are properties of
 * the write path in server/store.ts.
 */
export async function register() {
  // The edge runtime has no filesystem and no firebase-admin; only the Node
  // server boots this. And `next build` evaluates this file too — a build machine
  // holds no credentials and must not need them.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const [{ assertEnv }, { assertQuizWellFormed, STAGES }, { sweep }] = await Promise.all([
    import('@/server/env'),
    import('@/server/quiz'),
    import('@/server/ratelimit')
  ]);

  assertEnv();
  assertQuizWellFormed();

  // Drops expired rate-limit windows. `unref` so the timer never holds the
  // process open on shutdown.
  setInterval(sweep, 5 * 60_000).unref();

  const ladder = STAGES.map(s => `${s.id}[${s.sectionIds.join('+')}]→${s.cutoff}`).join(' ');
  console.log(`[api] ready — ${ladder}`);
}
