/**
 * Boot. Next calls `register()` once per server process, before the first
 * request — which is the hook the old standalone `server/index.ts` used to be.
 *
 * Three things have to happen here and nowhere else:
 *   - the environment is validated, so a deploy missing RUN_COOKIE_SECRET dies
 *     at start rather than at whichever request first tries to sign a cookie;
 *   - the answer key is checked against the question list, so a question added
 *     without an answer fails while someone is watching instead of mid-event;
 *   - migrations run, so a fresh box converges on the schema by starting.
 */
export async function register() {
  // The edge runtime has no `pg` and no filesystem; only the Node server boots
  // the database. And `next build` evaluates this file too — migrating from a
  // build machine that has no database would fail the build for no reason.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const [{ assertEnv }, { migrate }, { sweep }, { assertKeyCoversQuestions }, { quizQuestions }] =
    await Promise.all([
      import('@/server/env'),
      import('@/server/db'),
      import('@/server/ratelimit'),
      import('@/server/answers'),
      import('@/content/quizQuestions')
    ]);

  assertEnv();
  assertKeyCoversQuestions(quizQuestions.map(q => q.id));
  await migrate();

  // Drops expired rate-limit windows. `unref` so the timer never holds the
  // process open on shutdown.
  setInterval(sweep, 5 * 60_000).unref();

  console.log('[api] ready');
}
