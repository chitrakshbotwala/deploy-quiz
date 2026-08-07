import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { fs } from './firebase';
import type { Identity } from './firebase';
import {
  STAGES,
  questionOf,
  questionOrder,
  sectionById,
  sectionsOfStage,
  stageById
} from './quiz';
import type { SectionConfig, StageConfig } from './quiz';
import type {
  AdminBoardResponse,
  AdminRow,
  EventState,
  EventStatus,
  SectionResult,
  SectionState,
  SectionStatus,
  StageState
} from './types';

/**
 * Every read and write the quiz makes, and the rules that make the ladder a
 * ladder.
 *
 * ── The shape on disk ───────────────────────────────────────────────────────
 *   event/state                                         started, stopped, when
 *   participants/{uid}                                  who signed in
 *   sections/{sectionId}/attempts/{uid}                 one attempt, ever
 *   sections/{sectionId}/attempts/{uid}/answers/{qId}   one lock, ever
 *   stages/{stageId}                                    cut metadata
 *   stages/{stageId}/standings/{uid}                    the stage total
 *   stages/{stageId}/cutMembers/{uid}                   the frozen cut, ranked
 *
 * Document ids are the participant's uid, never generated. That is what makes
 * "one attempt per section per person" a property of the database rather than a
 * check in a route: a second attempt is the same document id, and every write
 * that opens one is a transaction that refuses to overwrite a finished attempt.
 * The same holds one level down, where a locked answer cannot be relocked.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * Ranking is score first, then total answering time — a tie on score goes to
 * whoever spent less time on the questions. Firestore cannot order by two fields
 * in opposite directions without a composite index, so both are folded into one
 * ascending string, `sortKey`, and it is written only for a participant who has
 * finished every section in the stage. Firestore skips documents that lack the
 * field being ordered, so "rank the people who finished" needs no query filter
 * and therefore no composite index at all.
 *
 * ── Time ────────────────────────────────────────────────────────────────────
 * The measured time is the sum of per-question answering time, not wall clock
 * from start to finish. A question is served with a server-stamped deadline, and
 * time is only ever counted from that stamp — so a locked phone, a refresh, or a
 * slow network cannot inflate anyone's clock, and a question left unserved costs
 * the full budget rather than nothing (otherwise walking away would be the
 * fastest possible run).
 */

/** How late a lock may arrive and still count, to cover the network round-trip. */
const LOCK_GRACE_MS = 1_200;

const eventRef = () => fs().collection('event').doc('state');
const participants = () => fs().collection('participants');
const attempts = (sectionId: string) => fs().collection('sections').doc(sectionId).collection('attempts');
const answers = (sectionId: string, uid: string) => attempts(sectionId).doc(uid).collection('answers');
const stageDoc = (stageId: string) => fs().collection('stages').doc(stageId);
const standings = (stageId: string) => stageDoc(stageId).collection('standings');
const cutMembers = (stageId: string) => stageDoc(stageId).collection('cutMembers');

// ── Documents ────────────────────────────────────────────────────────────────

interface AttemptDoc {
  uid: string;
  name: string;
  email: string;
  sectionId: string;
  stageId: string;
  startedAt: Timestamp;
  finishedAt: Timestamp | null;
  /** Null until finished. Both are what the standings sum. */
  score: number | null;
  elapsedMs: number | null;
  answered: number;
  ip: string | null;
  userAgent: string | null;
}

interface AnswerDoc {
  qId: string;
  servedAt: Timestamp;
  deadlineAt: Timestamp;
  lockedAt: Timestamp | null;
  /** Null means nothing was locked in time. */
  choice: number | null;
  correct: boolean;
  elapsedMs: number;
}

interface StandingDoc {
  uid: string;
  name: string;
  email: string;
  stageId: string;
  score: number;
  elapsedMs: number;
  /** Per-section, keyed by section id. */
  sections: Record<string, { score: number; elapsedMs: number }>;
  complete: boolean;
  completedAt: Timestamp | null;
  /** Present only when `complete`. See the note on ordering above. */
  sortKey?: string;
}

interface CutMemberDoc {
  uid: string;
  name: string;
  email: string;
  rank: number;
  score: number;
  elapsedMs: number;
  eligible: boolean;
}

interface StageMetaDoc {
  stageId: string;
  cutAt: Timestamp;
  cutoff: number;
  ranked: number;
  eligible: number;
}

/**
 * Score descending, time ascending, as one ascending string. Score is inverted
 * into a fixed width so a bigger score sorts earlier; time is zero-padded wide
 * enough for any run a ten-second-per-question section can produce.
 */
function sortKeyOf(score: number, elapsedMs: number): string {
  return `${String(99_999 - score).padStart(5, '0')}:${String(Math.round(elapsedMs)).padStart(10, '0')}`;
}

const iso = (t: Timestamp | null) => (t ? t.toDate().toISOString() : null);
const secondsOf = (ms: number) => Math.max(0, Math.round(ms / 1000));

// ── The event itself ─────────────────────────────────────────────────────────

interface EventDoc {
  status: EventStatus;
  startedAt: Timestamp | null;
  stoppedAt: Timestamp | null;
}

/**
 * Whether the quiz is live, in one document.
 *
 * Sign-in does not depend on this: people register, land on their ladder, and wait
 * there. Only opening a section and being handed a question do — and both are
 * checked here on the server rather than by hiding a button, because a hidden
 * button is not a rule.
 *
 * `idle` is the state of a project nobody has pressed start on yet, so the absent
 * document reads as "not started" without anything having to seed it.
 *
 * ── Why this is cached ──────────────────────────────────────────────────────
 * Every waiting participant polls this while the quiz has not started. A hall of
 * 900 laptops polling every eight seconds is ~110 requests a second, and an
 * uncached read would bill 400,000 Firestore reads an hour to answer a question
 * whose answer changes twice all evening. Two seconds of process cache takes that
 * to at most one read every two seconds, and two seconds is well inside the eight
 * a client waits anyway. `startEvent`/`stopEvent` bust it, so an organiser pressing
 * start sees it immediately rather than up to two seconds later.
 */
const EVENT_CACHE = Symbol.for('dor-quiz.event');
type EventCache = typeof globalThis & { [EVENT_CACHE]?: { at: number; doc: EventDoc | null } };
const EVENT_TTL_MS = 2_000;

function eventPayload(doc: EventDoc | null): EventState {
  return {
    status: doc?.status ?? 'idle',
    startedAt: iso(doc?.startedAt ?? null),
    stoppedAt: iso(doc?.stoppedAt ?? null),
    now: new Date().toISOString()
  };
}

function cacheEvent(doc: EventDoc | null): void {
  (globalThis as EventCache)[EVENT_CACHE] = { at: Date.now(), doc };
}

export async function eventState(): Promise<EventState> {
  const cache = (globalThis as EventCache)[EVENT_CACHE];
  if (cache && Date.now() - cache.at < EVENT_TTL_MS) return eventPayload(cache.doc);
  const snap = await eventRef().get();
  const doc = snap.exists ? (snap.data() as EventDoc) : null;
  cacheEvent(doc);
  return eventPayload(doc);
}

/**
 * Starts the quiz, or resumes it after a stop.
 *
 * A resume keeps the original `startedAt`, so the elapsed clock on the admin board
 * measures the event rather than the current segment of it. Pass `restart` to
 * re-stamp it — for a false start, before anyone has answered anything.
 */
export async function startEvent(restart = false): Promise<EventState> {
  const now = Timestamp.now();
  const written = await fs().runTransaction(async tsx => {
    const snap = await tsx.get(eventRef());
    const previous = snap.exists ? (snap.data() as EventDoc) : null;
    const doc: EventDoc = {
      status: 'running',
      startedAt: restart || !previous?.startedAt ? now : previous.startedAt,
      stoppedAt: null
    };
    tsx.set(eventRef(), doc);
    return doc;
  });
  cacheEvent(written);
  return eventPayload(written);
}

/** Stops the quiz. See the note on the route for what "stopped" does and does not close. */
export async function stopEvent(): Promise<EventState> {
  const now = Timestamp.now();
  const written = await fs().runTransaction(async tsx => {
    const snap = await tsx.get(eventRef());
    const previous = snap.exists ? (snap.data() as EventDoc) : null;
    const doc: EventDoc = {
      status: 'stopped',
      startedAt: previous?.startedAt ?? now,
      stoppedAt: now
    };
    tsx.set(eventRef(), doc);
    return doc;
  });
  cacheEvent(written);
  return eventPayload(written);
}

// ── Participants ─────────────────────────────────────────────────────────────

/**
 * Upserts the signed-in account. Called once per sign-in, not per request.
 *
 * A transaction rather than a merged set, because `createdAt` has to survive a
 * second sign-in: Firestore has no "write this field only if absent", so a plain
 * merge with a server-timestamp sentinel would restamp it every time and the
 * field would end up meaning `lastSeenAt` twice. The name and address DO follow a
 * rename in Workspace — they are only ever read for the organisers' export.
 */
export async function touchParticipant(identity: Identity): Promise<void> {
  const ref = participants().doc(identity.uid);
  await fs().runTransaction(async tsx => {
    const snap = await tsx.get(ref);
    if (!snap.exists) {
      tsx.set(ref, {
        uid: identity.uid,
        name: identity.name,
        email: identity.email,
        createdAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp()
      });
      return;
    }
    tsx.update(ref, {
      name: identity.name,
      email: identity.email,
      lastSeenAt: FieldValue.serverTimestamp()
    });
  });
}

export async function participantOf(uid: string): Promise<Identity | null> {
  const snap = await participants().doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() as { uid: string; name: string; email: string };
  return { uid: data.uid, email: data.email, name: data.name };
}

// ── The ladder, as one participant sees it ───────────────────────────────────

interface LadderInputs {
  attempts: Map<string, AttemptDoc>;
  standings: Map<string, StandingDoc>;
  cuts: Map<string, StageMetaDoc>;
  members: Map<string, CutMemberDoc>;
}

async function readLadder(uid: string): Promise<LadderInputs> {
  const sectionIds = STAGES.flatMap(s => s.sectionIds);
  const stageIds = STAGES.map(s => s.id);

  const refs: DocumentReference[] = [
    ...sectionIds.map(id => attempts(id).doc(uid)),
    ...stageIds.map(id => standings(id).doc(uid)),
    ...stageIds.map(id => stageDoc(id)),
    ...stageIds.map(id => cutMembers(id).doc(uid))
  ];
  // One round-trip for the whole ladder rather than seven sequential gets.
  const snaps = await fs().getAll(...refs);

  const out: LadderInputs = { attempts: new Map(), standings: new Map(), cuts: new Map(), members: new Map() };
  let i = 0;
  for (const id of sectionIds) {
    const snap = snaps[i++];
    if (snap.exists) out.attempts.set(id, snap.data() as AttemptDoc);
  }
  for (const id of stageIds) {
    const snap = snaps[i++];
    if (snap.exists) out.standings.set(id, snap.data() as StandingDoc);
  }
  for (const id of stageIds) {
    const snap = snaps[i++];
    if (snap.exists) out.cuts.set(id, snap.data() as StageMetaDoc);
  }
  for (const id of stageIds) {
    const snap = snaps[i++];
    if (snap.exists) out.members.set(id, snap.data() as CutMemberDoc);
  }
  return out;
}

function sectionStateOf(
  section: SectionConfig,
  attempt: AttemptDoc | undefined,
  reachable: boolean,
  stageOpen: boolean
): SectionState {
  const total = section.questions.length;
  let status: SectionStatus;
  if (!stageOpen) status = 'barred';
  else if (attempt?.finishedAt) status = 'done';
  else if (attempt) status = 'in-progress';
  else if (reachable) status = 'open';
  else status = 'locked';

  return {
    id: section.id,
    stageId: section.stageId,
    label: section.label,
    blurb: section.blurb,
    secondsPerQuestion: section.secondsPerQuestion,
    questionCount: total,
    status,
    answered: attempt?.answered ?? 0,
    result:
      attempt?.finishedAt && attempt.score !== null && attempt.elapsedMs !== null
        ? { score: attempt.score, total, seconds: secondsOf(attempt.elapsedMs) }
        : null
  };
}

/**
 * The whole ladder for one participant: which sections they may attempt, what
 * they scored, and — once a cut is frozen — whether they are through.
 *
 * A stage is open to everyone until the stage before it has been cut. After the
 * cut it is open only to the participants the cut kept, and the ones it did not
 * are told their rank, which is the only ranking information any participant
 * ever receives.
 */
export async function ladderFor(uid: string): Promise<StageState[]> {
  const data = await readLadder(uid);
  const out: StageState[] = [];
  // Set once a stage refuses to let the participant through; every later stage
  // inherits it, so an eliminated participant sees the rest of the ladder shut
  // rather than teasingly open.
  let barredFromHere = false;

  for (const [i, stage] of STAGES.entries()) {
    const previous = i > 0 ? STAGES[i - 1] : null;
    const previousMember = previous ? data.members.get(previous.id) : null;
    const previousCut = previous ? data.cuts.get(previous.id) : null;

    // Stage 1 is open to anyone signed in. Every later stage needs the previous
    // stage's cut to exist AND to have kept them.
    let stageOpen: boolean;
    if (barredFromHere) stageOpen = false;
    else if (!previous) stageOpen = true;
    else stageOpen = Boolean(previousCut && previousMember?.eligible);

    const sections = sectionsOfStage(stage.id);
    const sectionStates: SectionState[] = [];
    // Sections within a stage are strictly in order: the next one opens when the
    // one before it is finished.
    let reachable = true;
    for (const section of sections) {
      const attempt = data.attempts.get(section.id);
      const state = sectionStateOf(section, attempt, reachable, stageOpen);
      sectionStates.push(state);
      reachable = state.status === 'done';
    }

    const standing = data.standings.get(stage.id);
    const member = data.members.get(stage.id);
    const cut = data.cuts.get(stage.id);
    const complete = sectionStates.every(s => s.status === 'done');

    let status: StageState['status'];
    // 'locked' covers both "the previous stage has not been cut yet" and "it was,
    // and you are not in it" — the participant learns which from the previous
    // stage's own status, which carries their rank.
    if (!stageOpen) status = 'locked';
    else if (!complete) status = 'open';
    else if (!cut || !member) status = 'awaiting-cut';
    else status = member.eligible ? 'advanced' : 'eliminated';

    if (status === 'eliminated' || status === 'locked') barredFromHere = true;

    out.push({
      id: stage.id,
      label: stage.label,
      status,
      cutoff: stage.cutoff,
      sections: sectionStates,
      score: standing?.score ?? 0,
      total: sections.reduce((n, s) => n + s.questions.length, 0),
      seconds: secondsOf(standing?.elapsedMs ?? 0),
      rank: member?.rank ?? null,
      rankedOf: cut?.ranked ?? null,
      // The last stage's cut produces the finalists.
      finalist: Boolean(member?.eligible && i === STAGES.length - 1)
    });
  }
  return out;
}

/** The state of one section, from a ladder already read. */
export function sectionStateIn(ladder: StageState[], sectionId: string): SectionState | null {
  for (const stage of ladder) {
    const found = stage.sections.find(s => s.id === sectionId);
    if (found) return found;
  }
  return null;
}

// ── Attempts ─────────────────────────────────────────────────────────────────

export type OpenResult =
  | { ok: true; attempt: AttemptDoc }
  | { ok: false; reason: 'section-done' };

/**
 * Opens the attempt, or hands back the one already open. The caller has already
 * checked that the section is reachable; this is the write that makes it real.
 */
export async function openAttempt(
  section: SectionConfig,
  identity: Identity,
  ip: string | null,
  userAgent: string | null
): Promise<OpenResult> {
  const ref = attempts(section.id).doc(identity.uid);
  return fs().runTransaction(async tsx => {
    const snap = await tsx.get(ref);
    if (snap.exists) {
      const attempt = snap.data() as AttemptDoc;
      if (attempt.finishedAt) return { ok: false as const, reason: 'section-done' as const };
      return { ok: true as const, attempt };
    }
    const attempt: AttemptDoc = {
      uid: identity.uid,
      name: identity.name,
      email: identity.email,
      sectionId: section.id,
      stageId: section.stageId,
      startedAt: Timestamp.now(),
      finishedAt: null,
      score: null,
      elapsedMs: null,
      answered: 0,
      ip,
      userAgent
    };
    tsx.set(ref, attempt);
    return { ok: true as const, attempt };
  });
}

export interface Serve {
  qId: string;
  servedAt: Timestamp;
  deadlineAt: Timestamp;
}

export type ServeResult =
  | { kind: 'serve'; serve: Serve }
  | { kind: 'exhausted' }
  | { kind: 'no-attempt' }
  | { kind: 'finished' };

/**
 * Hands out the next question and stamps its deadline.
 *
 * The server chooses which question that is — the client does not get to ask for
 * one — so the order cannot be shopped and a question cannot be re-opened. A
 * refresh mid-question returns the SAME stamp rather than a fresh one, which is
 * the whole reason the deadline is stored: otherwise reloading the page would be
 * a way to buy another ten seconds. A question whose deadline passed while the
 * tab was gone is locked as expired here, on the way past.
 */
export async function serveNext(section: SectionConfig, uid: string): Promise<ServeResult> {
  const attemptRef = attempts(section.id).doc(uid);
  const order = questionOrder(section.id);

  return fs().runTransaction(async tsx => {
    const attemptSnap = await tsx.get(attemptRef);
    if (!attemptSnap.exists) return { kind: 'no-attempt' as const };
    const attempt = attemptSnap.data() as AttemptDoc;
    if (attempt.finishedAt) return { kind: 'finished' as const };

    const answerSnaps = await tsx.get(answers(section.id, uid));
    const byId = new Map(answerSnaps.docs.map(d => [d.id, d.data() as AnswerDoc]));
    const now = Timestamp.now();

    for (const qId of order) {
      const existing = byId.get(qId);
      if (existing?.lockedAt) continue;
      if (existing) {
        // Served already. Either it is still live — hand back the same deadline —
        // or it expired unattended, in which case it is closed with no answer and
        // the loop moves on.
        if (existing.deadlineAt.toMillis() + LOCK_GRACE_MS > now.toMillis()) {
          return { kind: 'serve' as const, serve: { qId, servedAt: existing.servedAt, deadlineAt: existing.deadlineAt } };
        }
        lockExpired(tsx, section, uid, existing, now);
        continue;
      }
      const servedAt = now;
      const deadlineAt = Timestamp.fromMillis(now.toMillis() + section.secondsPerQuestion * 1000);
      const doc: AnswerDoc = {
        qId,
        servedAt,
        deadlineAt,
        lockedAt: null,
        choice: null,
        correct: false,
        elapsedMs: 0
      };
      tsx.set(answers(section.id, uid).doc(qId), doc);
      return { kind: 'serve' as const, serve: { qId, servedAt, deadlineAt } };
    }
    return { kind: 'exhausted' as const };
  });
}

/** Closes an unattended question at its full budget. Shares the caller's transaction. */
function lockExpired(
  tsx: Transaction,
  section: SectionConfig,
  uid: string,
  answer: AnswerDoc,
  now: Timestamp
): void {
  tsx.update(answers(section.id, uid).doc(answer.qId), {
    lockedAt: now,
    choice: null,
    correct: false,
    elapsedMs: section.secondsPerQuestion * 1000
  });
  tsx.update(attempts(section.id).doc(uid), { answered: FieldValue.increment(1) });
}

export type LockResult =
  | { kind: 'locked'; answered: number; nextQId: string | null; expired: boolean }
  | { kind: 'no-attempt' }
  | { kind: 'finished' }
  | { kind: 'not-served' }
  | { kind: 'already' };

/**
 * Locks one answer. The verdict is written down and is NOT returned — see the
 * note in server/types.ts about why the browser never learns it.
 *
 * A lock that arrives after the deadline (plus a grace window for the round-trip)
 * is recorded as no answer at all, which is the same outcome as never clicking.
 * That is what makes the ten seconds real: the client's countdown is a drawing of
 * this rule, not the rule itself.
 */
export async function lockAnswer(
  section: SectionConfig,
  uid: string,
  qId: string,
  choice: number | null
): Promise<LockResult> {
  const attemptRef = attempts(section.id).doc(uid);
  const answerRef = answers(section.id, uid).doc(qId);
  const order = questionOrder(section.id);
  const key = questionOf(section.id, qId);
  if (!key) return { kind: 'not-served' };

  return fs().runTransaction(async tsx => {
    const [attemptSnap, answerSnap, answerSnaps] = await Promise.all([
      tsx.get(attemptRef),
      tsx.get(answerRef),
      tsx.get(answers(section.id, uid))
    ]);
    if (!attemptSnap.exists) return { kind: 'no-attempt' as const };
    if ((attemptSnap.data() as AttemptDoc).finishedAt) return { kind: 'finished' as const };
    if (!answerSnap.exists) return { kind: 'not-served' as const };

    const answer = answerSnap.data() as AnswerDoc;
    if (answer.lockedAt) return { kind: 'already' as const };

    const now = Timestamp.now();
    const budgetMs = section.secondsPerQuestion * 1000;
    const expired = now.toMillis() > answer.deadlineAt.toMillis() + LOCK_GRACE_MS;
    const picked = expired ? null : choice;
    const elapsedMs = Math.min(budgetMs, Math.max(0, now.toMillis() - answer.servedAt.toMillis()));

    tsx.update(answerRef, {
      lockedAt: now,
      choice: picked,
      correct: picked !== null && picked === key.answer,
      // An expired question costs its whole budget, so running the clock down is
      // never cheaper than answering.
      elapsedMs: expired ? budgetMs : elapsedMs
    });
    tsx.update(attemptRef, { answered: FieldValue.increment(1) });

    const locked = new Set(
      answerSnaps.docs.filter(d => (d.data() as AnswerDoc).lockedAt).map(d => d.id)
    );
    locked.add(qId);
    const nextQId = order.find(id => !locked.has(id)) ?? null;
    return { kind: 'locked' as const, answered: locked.size, nextQId, expired };
  });
}

export type FinishResult =
  | { kind: 'finished'; result: SectionResult }
  | { kind: 'no-attempt' };

/**
 * Closes the attempt and folds it into the stage standing.
 *
 * Idempotent: a double submit returns the same numbers rather than restamping
 * anything. Questions never served are charged their full budget, for the reason
 * given at the top of this file.
 */
export async function finishSection(section: SectionConfig, uid: string): Promise<FinishResult> {
  const attemptRef = attempts(section.id).doc(uid);
  const standingRef = standings(section.stageId).doc(uid);
  const order = questionOrder(section.id);
  const budgetMs = section.secondsPerQuestion * 1000;
  const stage = stageById(section.stageId)!;

  return fs().runTransaction(async tsx => {
    const attemptSnap = await tsx.get(attemptRef);
    if (!attemptSnap.exists) return { kind: 'no-attempt' as const };
    const attempt = attemptSnap.data() as AttemptDoc;

    if (attempt.finishedAt && attempt.score !== null && attempt.elapsedMs !== null) {
      return {
        kind: 'finished' as const,
        result: { score: attempt.score, total: order.length, seconds: secondsOf(attempt.elapsedMs) }
      };
    }

    const answerSnaps = await tsx.get(answers(section.id, uid));
    const byId = new Map(answerSnaps.docs.map(d => [d.id, d.data() as AnswerDoc]));
    const now = Timestamp.now();

    let score = 0;
    let elapsedMs = 0;
    for (const qId of order) {
      const answer = byId.get(qId);
      if (!answer) {
        // Never served: the participant left. Charged in full.
        elapsedMs += budgetMs;
        continue;
      }
      if (!answer.lockedAt) {
        // Served, never locked. Same charge, no answer.
        lockExpired(tsx, section, uid, answer, now);
        elapsedMs += budgetMs;
        continue;
      }
      if (answer.correct) score += 1;
      elapsedMs += answer.elapsedMs;
    }

    tsx.update(attemptRef, { finishedAt: now, score, elapsedMs });

    // Fold into the stage total. Read inside the transaction so two sections
    // finishing at once cannot both write a total computed without the other.
    const standingSnap = await tsx.get(standingRef);
    const previous = standingSnap.exists ? (standingSnap.data() as StandingDoc) : null;
    const sections = { ...(previous?.sections ?? {}), [section.id]: { score, elapsedMs } };
    const totalScore = Object.values(sections).reduce((n, s) => n + s.score, 0);
    const totalMs = Object.values(sections).reduce((n, s) => n + s.elapsedMs, 0);
    const complete = stage.sectionIds.every(id => sections[id]);

    const standing: StandingDoc = {
      uid,
      name: attempt.name,
      email: attempt.email,
      stageId: stage.id,
      score: totalScore,
      elapsedMs: totalMs,
      sections,
      complete,
      completedAt: complete ? now : (previous?.completedAt ?? null),
      // Written only when the stage is complete: an unfinished participant is not
      // ranked, and leaving the field off is what keeps them out of the ordering
      // without a composite index. See the note at the top of the file.
      ...(complete ? { sortKey: sortKeyOf(totalScore, totalMs) } : {})
    };
    tsx.set(standingRef, standing, { merge: true });

    return {
      kind: 'finished' as const,
      result: { score, total: order.length, seconds: secondsOf(elapsedMs) }
    };
  });
}

// ── Cuts ─────────────────────────────────────────────────────────────────────

export interface CutSummary {
  stageId: string;
  cutoff: number;
  ranked: number;
  eligible: number;
  at: string;
}

/**
 * Freezes the cut for a stage: ranks everyone who finished all of its sections
 * and writes down who advances.
 *
 * This is a deliberate, admin-triggered moment rather than a live query, and the
 * difference matters. A live "am I in the top 150?" flickers — it can be true at
 * 19:04 and false at 19:06 because someone else finished — so a participant could
 * start stage 2 and be barred halfway through it. Freezing turns eligibility
 * into a fact with a timestamp, and it is also the only way to tell the 151st
 * participant a rank that will not change under them.
 *
 * Re-running it re-ranks from scratch, which is what you want if the cut was
 * taken too early: rows for participants who have since finished are added, and
 * `eligible` is recomputed for everyone.
 */
export async function takeCut(stage: StageConfig): Promise<CutSummary> {
  const snaps = await standings(stage.id).get();
  const rows = snaps.docs
    .map(d => d.data() as StandingDoc)
    .filter(s => s.complete && s.sortKey)
    .sort((a, b) => (a.sortKey! < b.sortKey! ? -1 : a.sortKey! > b.sortKey! ? 1 : 0));

  const now = Timestamp.now();
  // Chunked: a Firestore batch tops out at 500 writes, and a 150-person cut with
  // everyone else ranked behind it can be well past that.
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = fs().batch();
    rows.slice(i, i + CHUNK).forEach((row, j) => {
      const rank = i + j + 1;
      const member: CutMemberDoc = {
        uid: row.uid,
        name: row.name,
        email: row.email,
        rank,
        score: row.score,
        elapsedMs: row.elapsedMs,
        eligible: rank <= stage.cutoff
      };
      batch.set(cutMembers(stage.id).doc(row.uid), member);
    });
    await batch.commit();
  }

  const eligible = Math.min(rows.length, stage.cutoff);
  const meta: StageMetaDoc = {
    stageId: stage.id,
    cutAt: now,
    cutoff: stage.cutoff,
    ranked: rows.length,
    eligible
  };
  await stageDoc(stage.id).set(meta, { merge: true });

  return {
    stageId: stage.id,
    cutoff: stage.cutoff,
    ranked: rows.length,
    eligible,
    at: now.toDate().toISOString()
  };
}

/** Drops a frozen cut, reopening the stage. For a cut taken by mistake. */
export async function clearCut(stage: StageConfig): Promise<void> {
  const snaps = await cutMembers(stage.id).get();
  const CHUNK = 400;
  for (let i = 0; i < snaps.docs.length; i += CHUNK) {
    const batch = fs().batch();
    for (const doc of snaps.docs.slice(i, i + CHUNK)) batch.delete(doc.ref);
    await batch.commit();
  }
  await stageDoc(stage.id).set(
    { cutAt: FieldValue.delete(), cutoff: FieldValue.delete(), ranked: FieldValue.delete(), eligible: FieldValue.delete() },
    { merge: true }
  );
}

// ── The admin board ──────────────────────────────────────────────────────────

/**
 * Full standings for one stage, best first, with addresses and the per-section
 * breakdown. Sorted here rather than in Firestore so participants who have not
 * finished the stage still appear — they have no `sortKey`, so an ordered query
 * would drop them, and "who is stuck halfway" is exactly what an organiser wants
 * to see mid-event.
 */
export async function adminBoard(stage: StageConfig): Promise<AdminBoardResponse> {
  const sections = sectionsOfStage(stage.id);
  const [standingSnaps, memberSnaps, metaSnap] = await Promise.all([
    standings(stage.id).get(),
    cutMembers(stage.id).get(),
    stageDoc(stage.id).get()
  ]);

  const members = new Map(memberSnaps.docs.map(d => [d.id, d.data() as CutMemberDoc]));
  const total = sections.reduce((n, s) => n + s.questions.length, 0);

  const rows: AdminRow[] = standingSnaps.docs
    .map(d => d.data() as StandingDoc)
    .sort((a, b) => {
      // Complete runs first, then the same score/time ordering the cut uses.
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return a.elapsedMs - b.elapsedMs;
    })
    .map((row, i) => ({
      rank: i + 1,
      uid: row.uid,
      name: row.name,
      email: row.email,
      score: row.score,
      total,
      seconds: secondsOf(row.elapsedMs),
      sections: sections.map(s => {
        const entry = row.sections?.[s.id];
        return entry
          ? { score: entry.score, total: s.questions.length, seconds: secondsOf(entry.elapsedMs) }
          : null;
      }),
      eligible: members.get(row.uid)?.eligible ?? null
    }));

  const meta = metaSnap.exists ? (metaSnap.data() as Partial<StageMetaDoc>) : null;

  return {
    stageId: stage.id,
    label: stage.label,
    cutoff: stage.cutoff,
    sectionIds: sections.map(s => s.id),
    rows,
    completed: rows.filter(r => r.sections.every(s => s !== null)).length,
    started: rows.length,
    cut:
      meta?.cutAt && meta.cutoff !== undefined
        ? {
            at: iso(meta.cutAt)!,
            cutoff: meta.cutoff,
            ranked: meta.ranked ?? 0,
            eligible: meta.eligible ?? 0
          }
        : null
  };
}

export async function adminBoards(): Promise<AdminBoardResponse[]> {
  return Promise.all(STAGES.map(stage => adminBoard(stage)));
}

/** The section a caller asked for, or null. Guards every route that takes an id. */
export function knownSection(sectionId: string): SectionConfig | null {
  return sectionById(sectionId);
}
