import { Hono } from 'hono';
import type { Context } from 'hono';
import { db, tx } from './db';
import { env } from './env';
import { answerKey, isKnownQuestion, questionOrder, TOTAL } from './answers';
import { clearRunCookie, issueRunCookie, readRunId } from './session';
import { clientIp, take } from './ratelimit';
import { verifyGoogleCredential } from './google';
import {
  bestStreakOf,
  buildFinishResponse,
  currentStreakOf,
  loadPicks,
  rankOf,
  scoreOf,
  toAnswered
} from './run';
import type {
  ApiError,
  BootResponse,
  LeaderboardResponse,
  PickResponse,
  StartResponse
} from './types';

function fail(c: Context, status: number, error: ApiError['error'], message: string) {
  return c.json<ApiError>({ error, message }, status as never);
}

export const api = new Hono();

api.get('/health', c => c.json({ ok: true }));

/**
 * Resume from the cookie alone.
 *
 * The client calls this on mount so a refresh mid-run lands back on the right
 * question without retyping anything. It is the ONLY resume path — see the note
 * on /run/start about why re-entering an email deliberately does not resume.
 */
api.get('/run/current', async c => {
  const policy = { emailDomains: env.emailDomains, googleClientId: env.googleClientId };
  const runId = readRunId(c);
  if (!runId) return c.json<BootResponse>({ run: null, ...policy });
  const { rows } = await db().query<{ started_at: Date; finished_at: Date | null }>(
    'select started_at, finished_at from runs where id = $1',
    [runId]
  );
  if (!rows.length) {
    // Signed cookie for a run that no longer exists (database reset between
    // events). Drop it rather than leaving the client in a loop.
    clearRunCookie(c);
    return c.json<BootResponse>({ run: null, ...policy });
  }
  const picks = await loadPicks(runId);
  const body: StartResponse = {
    startedAt: rows[0].started_at.toISOString(),
    answered: toAnswered(picks),
    finished: rows[0].finished_at ? await buildFinishResponse(runId) : null
  };
  return c.json<BootResponse>({ run: body, ...policy });
});

/**
 * Sign in with Google and open a run.
 *
 * Identity is not asserted by the caller any more. The body carries an ID token
 * that Google signed, and `verifyGoogleCredential` checks the signature, the
 * audience and the `hd` claim before a row is touched. The practical difference
 * is that a visitor can no longer sign in as anyone but themselves — which
 * matters more here than it usually would, because attempts are one per person
 * and enforced hard, so being able to sign up as a classmate meant being able to
 * destroy the only run they would ever get.
 *
 * Resume is still NOT offered on identity alone. If an account already has a run
 * and the caller is not holding that run's signed cookie, this returns 409:
 * signing in again on a second device must not reopen a run that is halfway
 * through somewhere else. Clearing cookies ends your attempt, which is the
 * correct trade for a scored board.
 */
api.post('/run/start', async c => {
  const ip = clientIp(c);
  if (!take(`start:${ip}`, 12, 10 * 60_000)) {
    return fail(c, 429, 'rate-limited', 'Too many sign-ins from this address. Wait a few minutes.');
  }

  const body = (await c.req.json().catch(() => null)) as { credential?: unknown } | null;
  const credential = typeof body?.credential === 'string' ? body.credential : '';
  if (!credential) return fail(c, 400, 'invalid-body', 'Sign in with Google to start.');

  const verified = await verifyGoogleCredential(credential);
  if (!verified.ok) {
    if (verified.reason === 'unverified-email') {
      return fail(c, 403, 'unverified-email', 'Google has not verified that address.');
    }
    if (verified.reason === 'wrong-domain') {
      const want = env.emailDomains[0];
      return fail(
        c,
        403,
        'email-domain',
        verified.hd
          ? `That is a @${verified.hd} account. Sign in with your @${want} one.`
          : `Sign in with your @${want} account, not a personal Google account.`
      );
    }
    return fail(c, 401, 'invalid-token', 'That sign-in could not be verified. Try again.');
  }
  const { sub, email, name } = verified.identity;

  const cookieRunId = readRunId(c);
  const userAgent = c.req.header('user-agent')?.slice(0, 300) ?? null;

  const result = await tx(async client => {
    // Keyed on `google_sub`, not on the address: Workspace accounts can be
    // renamed, and the sub is the thing Google promises is stable.
    //
    // `do update set name = participants.name` is a deliberate no-op. It writes
    // nothing, but it still takes the row lock and returns the id, which lets the
    // run check below happen BEFORE any detail is touched. An earlier version
    // wrote `excluded.name` here, and while sign-in makes that far harder to
    // abuse than the old form did, a rejected sign-in still has no business
    // editing a row it was just refused.
    const { rows: pRows } = await client.query<{ id: string }>(
      `insert into participants (name, email, google_sub)
            values ($1, $2, $3)
       on conflict (google_sub)
       do update set name = participants.name
         returning id`,
      [name, email, sub]
    );
    const participantId = pRows[0].id;

    // `for update` so two tabs submitting at once cannot both pass the "no run
    // yet" check and race the unique constraint into a 500.
    const { rows: existing } = await client.query<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
    }>('select id, started_at, finished_at from runs where participant_id = $1 for update', [participantId]);

    if (existing.length) {
      const run = existing[0];
      if (run.id !== cookieRunId) return { kind: 'taken' as const, finished: run.finished_at !== null };
      return { kind: 'resume' as const, runId: run.id, startedAt: run.started_at, finished: run.finished_at };
    }

    // Past the run check, so this sign-in is the one that counts. Only now is
    // the profile refreshed — a display name that changed in Workspace since a
    // previous visit should follow, but a run already under way must not be
    // relabelled underneath its leaderboard row.
    await client.query('update participants set name = $2, email = $3 where id = $1', [
      participantId,
      name,
      email
    ]);

    const { rows: created } = await client.query<{ id: string; started_at: Date }>(
      `insert into runs (participant_id, ip, user_agent) values ($1, $2, $3) returning id, started_at`,
      [participantId, ip === 'unknown' ? null : ip, userAgent]
    );
    return { kind: 'new' as const, runId: created[0].id, startedAt: created[0].started_at };
  });

  if (result.kind === 'taken') {
    return fail(
      c,
      409,
      'already-ran',
      result.finished
        ? 'You have already completed the quiz. One attempt per person.'
        : 'You already have a run in progress on another device. Finish it there.'
    );
  }

  issueRunCookie(c, result.runId);
  const picks = result.kind === 'resume' ? await loadPicks(result.runId) : [];
  const payload: StartResponse = {
    startedAt: result.startedAt.toISOString(),
    answered: toAnswered(picks),
    finished:
      result.kind === 'resume' && result.finished ? await buildFinishResponse(result.runId) : null
  };
  return c.json(payload);
});

/**
 * Record one answer and hand back the verdict.
 *
 * The answer key is consulted here and nowhere else. `picks`' primary key does
 * the enforcement: a second POST for the same question inserts nothing and is
 * rejected, so a visitor cannot pick, read the returned answer, and re-pick.
 */
api.post('/run/pick', async c => {
  const runId = readRunId(c);
  if (!runId) return fail(c, 401, 'no-run', 'No run in progress. Start the quiz again.');

  const body = (await c.req.json().catch(() => null)) as { qId?: unknown; choice?: unknown } | null;
  const qId = typeof body?.qId === 'string' ? body.qId : '';
  const choice = typeof body?.choice === 'number' ? body.choice : -1;
  if (!isKnownQuestion(qId)) return fail(c, 400, 'unknown-question', 'No such question.');
  if (!Number.isInteger(choice) || choice < 0 || choice > 9) {
    return fail(c, 400, 'invalid-body', 'Bad option index.');
  }

  const key = answerKey[qId];
  const outcome = await tx(async client => {
    const { rows } = await client.query<{ finished_at: Date | null }>(
      'select finished_at from runs where id = $1 for update',
      [runId]
    );
    if (!rows.length) return { kind: 'no-run' as const };
    if (rows[0].finished_at) return { kind: 'finished' as const };

    const correct = choice === key.answer;
    const { rowCount } = await client.query(
      `insert into picks (run_id, q_id, choice, correct) values ($1, $2, $3, $4)
       on conflict (run_id, q_id) do nothing`,
      [runId, qId, choice, correct]
    );
    if (!rowCount) return { kind: 'already' as const };

    const picks = await loadPicks(runId, client);
    return { kind: 'ok' as const, correct, score: scoreOf(picks), streak: currentStreakOf(picks) };
  });

  if (outcome.kind === 'no-run') return fail(c, 401, 'no-run', 'No run in progress.');
  if (outcome.kind === 'finished') return fail(c, 409, 'run-finished', 'This run is already closed.');
  if (outcome.kind === 'already') return fail(c, 409, 'already-answered', 'That question is already answered.');

  return c.json<PickResponse>({
    correct: outcome.correct,
    answer: key.answer,
    note: key.note,
    score: outcome.score,
    streak: outcome.streak
  });
});

/**
 * Close the run. Idempotent — a double-submit returns the same readout rather
 * than restamping `finished_at` and inflating the visitor's time.
 */
api.post('/run/finish', async c => {
  const runId = readRunId(c);
  if (!runId) return fail(c, 401, 'no-run', 'No run in progress.');

  const ok = await tx(async client => {
    const { rows } = await client.query<{ finished_at: Date | null }>(
      'select finished_at from runs where id = $1 for update',
      [runId]
    );
    if (!rows.length) return false;
    if (rows[0].finished_at) return true;

    const picks = await loadPicks(runId, client);
    await client.query('update runs set finished_at = now(), score = $2, best_streak = $3 where id = $1', [
      runId,
      scoreOf(picks),
      bestStreakOf(picks)
    ]);
    return true;
  });
  if (!ok) return fail(c, 401, 'no-run', 'No run in progress.');

  const payload = await buildFinishResponse(runId);
  if (!payload) return fail(c, 500, 'server-error', 'Could not build the readout.');
  return c.json(payload);
});

/**
 * Public board. Names only — the address that comes back with a signed-in
 * account is for the organisers' export and never leaves the database.
 */
api.get('/leaderboard', async c => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
  const runId = readRunId(c);

  const { rows } = await db().query<{
    id: string;
    name: string;
    score: number;
    seconds: string;
  }>(
    `select r.id, p.name, r.score,
            extract(epoch from (r.finished_at - r.started_at)) as seconds
       from runs r join participants p on p.id = r.participant_id
      where r.finished_at is not null
      order by r.score desc, (r.finished_at - r.started_at) asc
      limit $1`,
    [limit]
  );
  const { rows: countRows } = await db().query<{ n: string }>(
    'select count(*) as n from runs where finished_at is not null'
  );

  const payload: LeaderboardResponse = {
    rows: rows.map((row, i) => ({
      rank: i + 1,
      name: row.name,
      score: row.score,
      seconds: Math.max(0, Math.round(Number(row.seconds))),
      you: row.id === runId
    })),
    total: Number(countRows[0]?.n ?? 0)
  };

  // If the caller finished outside the visible window, append their own row so
  // they always see where they landed.
  if (runId && !payload.rows.some(r => r.you)) {
    const { rows: mine } = await db().query<{ name: string; score: number; seconds: string }>(
      `select p.name, r.score, extract(epoch from (r.finished_at - r.started_at)) as seconds
         from runs r join participants p on p.id = r.participant_id
        where r.id = $1 and r.finished_at is not null`,
      [runId]
    );
    if (mine.length) {
      payload.rows.push({
        rank: await rankOf(runId),
        name: mine[0].name,
        score: mine[0].score,
        seconds: Math.max(0, Math.round(Number(mine[0].seconds))),
        you: true
      });
    }
  }

  return c.json(payload);
});

export { questionOrder, TOTAL };
