/**
 * The API contract, shared by both sides.
 *
 * This file must stay free of imports and runtime values. The client pulls it in
 * with `import type`, which TypeScript erases entirely, so nothing under
 * server/ ever reaches the browser bundle. Add a real import or a `const` here
 * and that guarantee is gone.
 *
 * Note what is absent, deliberately: no `answer`, no `correct`, no `note`. The
 * browser is never told whether a pick was right — not per question, not in the
 * readout. A participant learns their total and nothing else, because this is a
 * selection round and the questions are reused across sections and stages.
 */

/**
 * Whether the quiz is live.
 *
 * `idle` — nobody has pressed start. People can still sign in and wait.
 * `running` — sections can be opened and questions handed out.
 * `stopped` — the organisers ended it. No new section, no new question.
 */
export type EventStatus = 'idle' | 'running' | 'stopped';

export interface EventState {
  status: EventStatus;
  /** Server clock, ISO. Null until the first start. Survives a stop. */
  startedAt: string | null;
  stoppedAt: string | null;
  /** Server clock at the moment of the response, so a client can correct drift. */
  now: string;
}

/** A question as the browser sees it. The answer index is not part of the shape. */
export interface PublicQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
  accent: string;
}

/** Where a participant stands on one section. */
export type SectionStatus =
  /** Not reachable yet — an earlier section in the stage is unfinished. */
  | 'locked'
  /** Reachable, not started. */
  | 'open'
  /** Started, not finished. Resumable. */
  | 'in-progress'
  /** Finished. One attempt per section, so this is terminal. */
  | 'done'
  /** The stage this section belongs to is closed to this participant. */
  | 'barred';

export interface SectionState {
  id: string;
  stageId: string;
  label: string;
  blurb: string;
  secondsPerQuestion: number;
  questionCount: number;
  status: SectionStatus;
  /** Questions locked so far. Where a resumed attempt picks up. */
  answered: number;
  /** Set once finished: what the participant is allowed to know about it. */
  result: SectionResult | null;
}

export interface SectionResult {
  score: number;
  total: number;
  /** Sum of the per-question answering time, in seconds. The tie-break. */
  seconds: number;
}

/** Where a participant stands on one stage. */
export type StageStatus =
  /** Sections still to attempt. */
  | 'open'
  /** Every section attempted; the cut has not been taken yet. */
  | 'awaiting-cut'
  /** The cut was taken and they are through. */
  | 'advanced'
  /** The cut was taken and they are not. Terminal, and it comes with a rank. */
  | 'eliminated'
  /** An earlier stage has not let them in yet. */
  | 'locked';

export interface StageState {
  id: string;
  label: string;
  status: StageStatus;
  cutoff: number;
  sections: SectionState[];
  /** Total across the stage's finished sections. */
  score: number;
  total: number;
  seconds: number;
  /** 1-based, from the frozen cut. Null until the cut is taken. */
  rank: number | null;
  /** How many were ranked in that cut, for the "of N" on the eliminated page. */
  rankedOf: number | null;
  /** Set on the final stage once its cut is taken and they made it. */
  finalist: boolean;
}

export interface SessionUser {
  name: string;
  email: string;
}

/**
 * The shape of the event, for the sign-in screen to describe before anyone is
 * signed in. Counts only — no question, no id, nothing that is not already on the
 * poster.
 */
export interface LadderPreview {
  stages: number;
  sections: number;
  secondsPerQuestion: number;
}

/**
 * What the page asks for on mount: who is signed in, if anyone, whether the quiz
 * is live, and the whole ladder as it stands for them.
 */
export interface StateResponse {
  user: SessionUser | null;
  stages: StageState[];
  preview: LadderPreview;
  /**
   * Sign-in never waits on this. A participant can register and sit on their
   * ladder before the organisers start anything, which is the point: the queue
   * forms before the event, not during it.
   */
  event: EventState;
  /** Bare domains, no `@`. Empty means any Google account is accepted. */
  emailDomains: string[];
  /** Server clock, ISO. The client aligns its countdown to this. */
  now: string;
}

/** A section, opened. Questions arrive stripped of their answers. */
export interface SectionRunResponse {
  section: SectionState;
  questions: PublicQuestion[];
  /**
   * The question the run is on, and its deadline, when an attempt was resumed
   * mid-question. Null when the next question has not been served yet.
   */
  serve: ServeResponse | null;
}

export interface ServeResponse {
  qId: string;
  /** Server clock, ISO. */
  servedAt: string;
  /** Server clock, ISO. Locks at this instant whether or not anything is picked. */
  deadlineAt: string;
  /** Server clock at the moment of the response, so the client can correct drift. */
  now: string;
}

/** `serve` is null when the section has no question left to hand out. */
export interface ServeEnvelope {
  serve: ServeResponse | null;
}

export interface LockResponse {
  /** Questions locked so far, including this one. */
  answered: number;
  /** Null when the section is out of questions. */
  nextQId: string | null;
  /**
   * True when the deadline had already passed. The client uses it only to stop
   * showing a selection it did not get to lock — never to say "wrong".
   */
  expired: boolean;
}

export interface FinishResponse extends SectionResult {
  /** The stage as it stands after this section closed. */
  stage: StageState;
}

/** One row of the admin board. Includes the address, which no participant sees. */
export interface AdminRow {
  rank: number;
  uid: string;
  name: string;
  email: string;
  score: number;
  total: number;
  seconds: number;
  /** Per-section breakdown, in stage order. Null for a section not finished. */
  sections: (SectionResult | null)[];
  /** From the frozen cut, when there is one. */
  eligible: boolean | null;
}

export interface AdminBoardResponse {
  stageId: string;
  label: string;
  cutoff: number;
  sectionIds: string[];
  /** Complete standings for the stage, best first. */
  rows: AdminRow[];
  /** Participants who have finished every section in the stage. */
  completed: number;
  /** Participants who have started anything in the stage. */
  started: number;
  /** Set once the cut is frozen. */
  cut: { at: string; cutoff: number; ranked: number; eligible: number } | null;
}

export interface AdminStagesResponse {
  boards: AdminBoardResponse[];
  event: EventState;
}

/** What freezing a cut reports back. */
export interface CutSummaryResponse {
  stageId: string;
  cutoff: number;
  /** How many had finished every section and were therefore ranked. */
  ranked: number;
  /** How many the cut kept. */
  eligible: number;
  at: string;
}

export interface OkResponse {
  ok: true;
}

export interface ApiError {
  error:
    | 'invalid-body'
    | 'invalid-token'
    | 'unverified-email'
    | 'wrong-provider'
    | 'email-domain'
    | 'not-signed-in'
    | 'not-admin'
    | 'quiz-not-started'
    | 'quiz-stopped'
    | 'unknown-section'
    | 'section-locked'
    | 'section-done'
    | 'not-eligible'
    | 'unknown-question'
    | 'out-of-order'
    | 'already-answered'
    | 'not-served'
    | 'rate-limited'
    | 'server-error';
  message: string;
}
