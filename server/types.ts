/**
 * The API contract, shared by both sides.
 *
 * This file must stay free of imports and runtime values. The client pulls it in
 * with `import type`, which TypeScript erases entirely, so nothing under
 * server/ ever reaches the browser bundle. Add a real import or a `const` here
 * and that guarantee is gone.
 */

/** One question the run has already answered. */
export interface AnsweredQuestion {
  qId: string;
  /** The option index the visitor chose. */
  choice: number;
  correct: boolean;
  /** The right option index. Only ever sent back after the pick is recorded. */
  answer: number;
  note: string;
}

export interface StartResponse {
  /** Server clock, ISO. The visible run timer reads from this, not Date.now(). */
  startedAt: string;
  /**
   * Non-empty when an in-flight run was resumed — a refresh, a dropped phone, a
   * closed tab. The client replays these into its state and drops the visitor
   * back on the first unanswered question.
   */
  answered: AnsweredQuestion[];
  /** Set when the resumed run was already finished; the client jumps to the readout. */
  finished: FinishResponse | null;
}

/**
 * What the page asks for on mount: whether the cookie in hand names a run, and
 * the sign-up policy to draw the form against.
 *
 * The domain list is served rather than duplicated into a `NEXT_PUBLIC_` variable so
 * there is one source of truth. The client check it feeds is a courtesy — it
 * spares a visitor a round-trip to be told their address is wrong — and the
 * server re-checks every sign-up regardless.
 */
export interface BootResponse {
  run: StartResponse | null;
  /** Bare domains, no `@`. Empty means any Google account is accepted. */
  emailDomains: string[];
  /**
   * The OAuth client id the sign-in button initialises with. Served rather than
   * built into the bundle so there is one source of truth, and so rotating it
   * does not require a frontend rebuild.
   */
  googleClientId: string;
}

export interface PickResponse {
  correct: boolean;
  answer: number;
  note: string;
  /** Server-authoritative running totals, so the rail cannot be argued with. */
  score: number;
  streak: number;
}

export interface ReviewEntry extends AnsweredQuestion {}

export interface FinishResponse {
  score: number;
  total: number;
  bestStreak: number;
  /** Server-measured, from run.started_at to run.finished_at. */
  seconds: number;
  /** 1-based position on the board at the moment the run closed. */
  rank: number;
  review: ReviewEntry[];
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  seconds: number;
  /** True for the row belonging to the requesting run, so it can be highlighted. */
  you: boolean;
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  total: number;
}

export interface ApiError {
  error:
    | 'invalid-body'
    | 'invalid-token'
    | 'unverified-email'
    | 'email-domain'
    | 'already-ran'
    | 'no-run'
    | 'run-finished'
    | 'unknown-question'
    | 'already-answered'
    | 'rate-limited'
    | 'server-error';
  message: string;
}
