import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { env } from './env';
import { verifyIdToken } from './firebase';
import { publicQuestions, sectionById, STAGES, stageById } from './quiz';
import { clientIp, take } from './ratelimit';
import {
  adminBoards,
  clearCut,
  eventState,
  finishSection,
  knownSection,
  ladderFor,
  lockAnswer,
  openAttempt,
  participantOf,
  sectionStateIn,
  serveNext,
  startEvent,
  stopEvent,
  takeCut,
  touchParticipant
} from './store';
import { clearAdmin, clearSession, isAdmin, issueAdmin, issueSession, readUid } from './session';
import type {
  AdminStagesResponse,
  ApiError,
  EventState,
  FinishResponse,
  LockResponse,
  SectionRunResponse,
  ServeEnvelope,
  StateResponse
} from './types';

function fail(c: Context, status: number, error: ApiError['error'], message: string) {
  return c.json<ApiError>({ error, message }, status as never);
}

export const api = new Hono();

api.get('/health', c => c.json({ ok: true }));

// ── Identity ─────────────────────────────────────────────────────────────────

async function stateFor(uid: string | null): Promise<StateResponse> {
  const sections = STAGES.flatMap(s => s.sectionIds);
  const event = await eventState();
  const base = {
    emailDomains: env.emailDomains,
    event,
    now: new Date().toISOString(),
    preview: {
      stages: STAGES.length,
      sections: sections.length,
      // The first section's budget stands for all of them on the sign-in screen.
      // They are per-section values in the JSON, and if a later section ever
      // differs the gate's "10s" line is the wrong place to explain that — the
      // ladder states each section's own budget.
      secondsPerQuestion: sectionById(sections[0])?.secondsPerQuestion ?? 10
    }
  };
  if (!uid) return { user: null, stages: [], ...base };
  const [identity, stages] = await Promise.all([participantOf(uid), ladderFor(uid)]);
  if (!identity) return { user: null, stages: [], ...base };
  return { user: { name: identity.name, email: identity.email }, stages, ...base };
}

/**
 * Mount-time probe: who is signed in, and the whole ladder as it stands for them.
 *
 * This is the only route the shell needs to draw any screen — gate, dashboard,
 * resumed section, or the eliminated page — because every one of those is a
 * function of the same state.
 */
api.get('/state', async c => c.json(await stateFor(readUid(c))));

/**
 * Just the event's state, and the route a waiting page polls.
 *
 * Separate from /state on purpose. /state costs nine Firestore reads because it
 * builds the whole ladder, and a hall of participants waiting for the organisers
 * to start would poll that into a bill for something none of them needs yet. This
 * one is a cached single document (see `eventState`), so the wait is nearly free,
 * and the client fetches the full state once — when this flips.
 */
api.get('/event', async c => c.json(await eventState()));

/**
 * Sign in with Firebase and open a session.
 *
 * The body carries an ID token minted by Firebase Auth after a Google popup.
 * `verifyIdToken` checks the signature, the audience, the provider and the email
 * domain before a document is touched, so a participant cannot sign in as anyone
 * but themselves — which matters more here than it usually would, because
 * attempts are one per person per section and enforced by document id, so being
 * able to sign in as a classmate would mean being able to burn the only attempt
 * that classmate will ever get.
 */
api.post('/auth/login', async c => {
  const ip = clientIp(c);
  if (!take(`login:${ip}`, 20, 10 * 60_000)) {
    return fail(c, 429, 'rate-limited', 'Too many sign-ins from this address. Wait a few minutes.');
  }

  const body = (await c.req.json().catch(() => null)) as { idToken?: unknown } | null;
  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
  if (!idToken) return fail(c, 400, 'invalid-body', 'Sign in with Google to start.');

  const verified = await verifyIdToken(idToken);
  if (!verified.ok) {
    if (verified.reason === 'unverified-email') {
      return fail(c, 403, 'unverified-email', 'Google has not verified that address.');
    }
    if (verified.reason === 'wrong-provider') {
      return fail(c, 403, 'wrong-provider', 'Sign in with Google, not with any other method.');
    }
    if (verified.reason === 'wrong-domain') {
      const want = env.emailDomains[0];
      return fail(
        c,
        403,
        'email-domain',
        verified.domain
          ? `That is a @${verified.domain} account. Sign in with your @${want} one.`
          : `Sign in with your @${want} account, not a personal Google account.`
      );
    }
    return fail(c, 401, 'invalid-token', 'That sign-in could not be verified. Try again.');
  }

  await touchParticipant(verified.identity);
  issueSession(c, verified.identity.uid);
  return c.json(await stateFor(verified.identity.uid));
});

api.post('/auth/logout', c => {
  clearSession(c);
  return c.json({ ok: true });
});

// ── A section ────────────────────────────────────────────────────────────────

/**
 * The event gate, checked on the two routes that hand out anything: opening a
 * section and being served a question.
 *
 * Locking an answer and finishing a section are deliberately NOT gated. When the
 * organisers press stop, someone is mid-question with eight seconds left, and
 * refusing their lock would throw away an answer they already gave. Stop therefore
 * means "no new questions" rather than "drop what is in flight", and a section
 * that had a question open can still be closed out and counted.
 */
function eventRefusal(event: EventState): { error: ApiError['error']; message: string } | null {
  if (event.status === 'running') return null;
  if (event.status === 'stopped') {
    return { error: 'quiz-stopped', message: 'The organisers have ended the quiz.' };
  }
  return {
    error: 'quiz-not-started',
    message: 'The quiz has not started yet. Wait for the organisers — this page will open on its own.'
  };
}

/**
 * Open a section, or resume the attempt already open.
 *
 * The gate is the ladder, not the request: `ladderFor` decides whether this
 * section is reachable for this participant, and the four ways it can refuse —
 * an earlier section unfinished, the stage not yet open, the cut went the other
 * way, the attempt already closed — are distinct answers because the client draws
 * a different screen for each.
 *
 * Questions come back stripped of their answers. See server/quiz.ts.
 */
api.post('/section/:id/open', async c => {
  const uid = readUid(c);
  if (!uid) return fail(c, 401, 'not-signed-in', 'Sign in to start.');
  if (overRunBudget(uid)) return fail(c, 429, 'rate-limited', 'Too many requests. Slow down.');
  const section = knownSection(c.req.param('id'));
  if (!section) return fail(c, 404, 'unknown-section', 'No such section.');

  const [identity, event] = await Promise.all([participantOf(uid), eventState()]);
  if (!identity) return fail(c, 401, 'not-signed-in', 'Sign in to start.');

  const ladder = await ladderFor(uid);
  const state = sectionStateIn(ladder, section.id);
  if (!state) return fail(c, 404, 'unknown-section', 'No such section.');

  // The event gate applies to STARTING a section, not to returning to one that is
  // already open. Someone whose tab died mid-section while the quiz was live has to
  // be able to come back and close it out after a stop — otherwise their attempt
  // stays unfinished, and an unfinished attempt is not ranked at all. They get no
  // new question either way: /serve is gated, so reopening hands them a section
  // with nothing left to answer, which closes and scores it.
  const refused = eventRefusal(event);
  if (refused && state.status !== 'in-progress') {
    return fail(c, 409, refused.error, refused.message);
  }
  if (state.status === 'barred') {
    return fail(c, 403, 'not-eligible', 'This round is not open to you.');
  }
  if (state.status === 'locked') {
    return fail(c, 409, 'section-locked', 'Finish the section before this one first.');
  }
  if (state.status === 'done') {
    return fail(c, 409, 'section-done', 'You have already completed this section.');
  }

  const opened = await openAttempt(
    section,
    identity,
    clientIp(c) === 'unknown' ? null : clientIp(c),
    c.req.header('user-agent')?.slice(0, 300) ?? null
  );
  if (!opened.ok) return fail(c, 409, 'section-done', 'You have already completed this section.');

  // A resumed attempt comes back mid-question with its original deadline, so a
  // refresh cannot buy more time. `serveNext` is the one place that decides.
  const served = await serveNext(section, uid);
  const payload: SectionRunResponse = {
    section: { ...state, status: 'in-progress', answered: opened.attempt.answered },
    questions: publicQuestions(section.id),
    serve:
      served.kind === 'serve'
        ? {
            qId: served.serve.qId,
            servedAt: served.serve.servedAt.toDate().toISOString(),
            deadlineAt: served.serve.deadlineAt.toDate().toISOString(),
            now: new Date().toISOString()
          }
        : null
  };
  return c.json(payload);
});

/**
 * Per-account budget on the hot routes.
 *
 * The database already bounds what these can DO — a question locks once, ever —
 * but it does not bound how often a client may ask, and a retry loop in a broken
 * tab can ask hundreds of times a minute. Each of those is a Firestore
 * transaction. This is the ceiling on the damage one wedged browser can bill,
 * pitched far above what a real run needs: 30 questions at 10 seconds is well
 * under a request a second.
 */
function overRunBudget(uid: string): boolean {
  return !take(`run:${uid}`, 240, 60_000);
}

/** The next question and its deadline, both chosen by the server. */
api.post('/section/:id/serve', async c => {
  const uid = readUid(c);
  if (!uid) return fail(c, 401, 'not-signed-in', 'Sign in to start.');
  if (overRunBudget(uid)) return fail(c, 429, 'rate-limited', 'Too many requests. Slow down.');
  const section = knownSection(c.req.param('id'));
  if (!section) return fail(c, 404, 'unknown-section', 'No such section.');

  const refused = eventRefusal(await eventState());
  if (refused) return fail(c, 409, refused.error, refused.message);

  const served = await serveNext(section, uid);
  if (served.kind === 'no-attempt') return fail(c, 409, 'section-locked', 'That section is not open.');
  if (served.kind === 'finished') return fail(c, 409, 'section-done', 'That section is already closed.');
  const payload: ServeEnvelope = {
    serve:
      served.kind === 'serve'
        ? {
            qId: served.serve.qId,
            servedAt: served.serve.servedAt.toDate().toISOString(),
            deadlineAt: served.serve.deadlineAt.toDate().toISOString(),
            now: new Date().toISOString()
          }
        : null
  };
  return c.json(payload);
});

/**
 * Lock one answer.
 *
 * `choice` may be null, which is what the client sends when the clock ran out
 * with nothing selected. Nothing about correctness comes back — the response
 * carries progress and the next question id, and that is all a participant is
 * entitled to know until the organisers publish results.
 */
api.post('/section/:id/lock', async c => {
  const uid = readUid(c);
  if (!uid) return fail(c, 401, 'not-signed-in', 'Sign in to start.');
  if (overRunBudget(uid)) return fail(c, 429, 'rate-limited', 'Too many requests. Slow down.');
  const section = knownSection(c.req.param('id'));
  if (!section) return fail(c, 404, 'unknown-section', 'No such section.');

  const body = (await c.req.json().catch(() => null)) as { qId?: unknown; choice?: unknown } | null;
  const qId = typeof body?.qId === 'string' ? body.qId : '';
  const choice =
    body?.choice === null || body?.choice === undefined
      ? null
      : typeof body.choice === 'number' && Number.isInteger(body.choice) && body.choice >= 0 && body.choice < 10
        ? body.choice
        : NaN;
  if (!qId) return fail(c, 400, 'invalid-body', 'Which question?');
  if (Number.isNaN(choice)) return fail(c, 400, 'invalid-body', 'Bad option index.');

  // The lock is never refused — an answer already given must land. What the event's
  // state decides is whether another question comes back with it.
  const event = await eventState();
  const locked = await lockAnswer(section, uid, qId, choice, event.status === 'running');
  if (locked.kind === 'no-attempt') return fail(c, 409, 'section-locked', 'That section is not open.');
  if (locked.kind === 'finished') return fail(c, 409, 'section-done', 'That section is already closed.');
  if (locked.kind === 'not-served') {
    return fail(c, 409, 'not-served', 'That question was not served to you.');
  }
  if (locked.kind === 'already') {
    return fail(c, 409, 'already-answered', 'That question is already locked.');
  }

  const payload: LockResponse = {
    answered: locked.answered,
    nextQId: locked.nextQId,
    expired: locked.expired,
    // Served inside the same transaction as the lock. /serve still exists for a
    // resume, but the run never needs it question-to-question any more.
    serve: locked.serve
      ? {
          qId: locked.serve.qId,
          servedAt: locked.serve.servedAt.toDate().toISOString(),
          deadlineAt: locked.serve.deadlineAt.toDate().toISOString(),
          now: new Date().toISOString()
        }
      : null
  };
  return c.json(payload);
});

/**
 * Close the section and fold it into the stage total. Idempotent — a double
 * submit returns the same numbers rather than restamping anything.
 */
api.post('/section/:id/finish', async c => {
  const uid = readUid(c);
  if (!uid) return fail(c, 401, 'not-signed-in', 'Sign in to start.');
  const section = knownSection(c.req.param('id'));
  if (!section) return fail(c, 404, 'unknown-section', 'No such section.');

  const done = await finishSection(section, uid);
  if (done.kind === 'no-attempt') return fail(c, 409, 'section-locked', 'That section is not open.');

  const stages = await ladderFor(uid);
  const stage = stages.find(s => s.id === section.stageId)!;
  const payload: FinishResponse = { ...done.result, stage };
  return c.json(payload);
});

// ── Admin ────────────────────────────────────────────────────────────────────

/**
 * The password gate.
 *
 * One shared password, compared in constant time, behind a hard per-IP limit —
 * six attempts an hour, which is unusable for guessing and plenty for an
 * organiser who mistyped. The password itself is an environment variable with no
 * default, so a deploy that forgot it fails at boot instead of serving an admin
 * area with a known key.
 */
api.post('/admin/login', async c => {
  const ip = clientIp(c);
  if (!take(`admin:${ip}`, 6, 60 * 60_000)) {
    return fail(c, 429, 'rate-limited', 'Too many attempts. Try again later.');
  }
  const body = (await c.req.json().catch(() => null)) as { password?: unknown } | null;
  const given = Buffer.from(typeof body?.password === 'string' ? body.password : '');
  const want = Buffer.from(env.adminPassword);
  const ok = given.length === want.length && timingSafeEqual(given, want);
  if (!ok) return fail(c, 401, 'not-admin', 'Wrong password.');
  issueAdmin(c);
  return c.json({ ok: true });
});

api.post('/admin/logout', c => {
  clearAdmin(c);
  return c.json({ ok: true });
});

api.get('/admin/session', c => c.json({ admin: isAdmin(c) }));

/**
 * Everything, ranked, with addresses. This is the leaderboard, and it exists
 * only here: no participant-facing route returns another participant's row, a
 * rank other than their own, or any score but their own total. The board is the
 * organisers' instrument.
 */
api.get('/admin/board', async c => {
  if (!isAdmin(c)) return fail(c, 401, 'not-admin', 'Admin only.');
  const [boards, event] = await Promise.all([adminBoards(), eventState()]);
  const payload: AdminStagesResponse = { boards, event };
  return c.json(payload);
});

/**
 * Start the quiz, or resume it after a stop.
 *
 * Until this is pressed, sign-in works and every section is shut: people register
 * and wait, which is what a room full of participants does anyway. Resuming keeps
 * the original start time so the elapsed clock measures the event; `restart: true`
 * re-stamps it, for a false start before anyone has answered anything.
 */
api.post('/admin/event/start', async c => {
  if (!isAdmin(c)) return fail(c, 401, 'not-admin', 'Admin only.');
  const body = (await c.req.json().catch(() => null)) as { restart?: unknown } | null;
  return c.json(await startEvent(body?.restart === true));
});

/** Stop it. See `eventRefusal` for exactly what stopping does and does not close. */
api.post('/admin/event/stop', async c => {
  if (!isAdmin(c)) return fail(c, 401, 'not-admin', 'Admin only.');
  return c.json(await stopEvent());
});

/** Freeze a stage's cut. See the note on `takeCut` for why this is a moment. */
api.post('/admin/cut', async c => {
  if (!isAdmin(c)) return fail(c, 401, 'not-admin', 'Admin only.');
  const body = (await c.req.json().catch(() => null)) as { stageId?: unknown } | null;
  const stage = typeof body?.stageId === 'string' ? stageById(body.stageId) : null;
  if (!stage) return fail(c, 400, 'invalid-body', 'Which stage?');
  return c.json(await takeCut(stage));
});

/** Undo a cut taken too early. The stage reopens and nobody is eliminated. */
api.post('/admin/cut/clear', async c => {
  if (!isAdmin(c)) return fail(c, 401, 'not-admin', 'Admin only.');
  const body = (await c.req.json().catch(() => null)) as { stageId?: unknown } | null;
  const stage = typeof body?.stageId === 'string' ? stageById(body.stageId) : null;
  if (!stage) return fail(c, 400, 'invalid-body', 'Which stage?');
  await clearCut(stage);
  return c.json({ ok: true });
});

/** CSV, for the organisers' own records. Same data as the board, one row each. */
api.get('/admin/export', async c => {
  if (!isAdmin(c)) return fail(c, 401, 'not-admin', 'Admin only.');
  const boards = await adminBoards();
  const cell = (value: string | number | null) => {
    const s = value === null ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines: string[] = [];
  for (const board of boards) {
    lines.push(`# ${board.label} (cutoff ${board.cutoff})`);
    lines.push(
      ['rank', 'name', 'email', 'score', 'total', 'seconds', ...board.sectionIds.flatMap(id => [`${id}_score`, `${id}_seconds`]), 'eligible']
        .map(cell)
        .join(',')
    );
    for (const row of board.rows) {
      lines.push(
        [
          row.rank,
          row.name,
          row.email,
          row.score,
          row.total,
          row.seconds,
          ...row.sections.flatMap(s => [s ? s.score : null, s ? s.seconds : null]),
          row.eligible === null ? '' : row.eligible ? 'yes' : 'no'
        ]
          .map(cell)
          .join(',')
      );
    }
    lines.push('');
  }

  return c.body(lines.join('\n'), 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="dor-quiz-${new Date().toISOString().slice(0, 10)}.csv"`
  });
});

export { STAGES };
