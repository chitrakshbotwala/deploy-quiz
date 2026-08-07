import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track } from '@/lib/firebase';
import { QuizApiError, quizApi } from '@/lib/quizApi';
import type { FinishResponse, PublicQuestion, SectionRunResponse, ServeResponse } from '@/lib/quizApi';

/**
 * The run engine for one section. Pure of DOM, timing decoration and animation,
 * so the two renderers (the WebGL asteroid field on desktop, the warp panels
 * everywhere else) share it verbatim.
 *
 * What it knows: which question is live, what is selected, how long is left, and
 * the score once the section closes. What it does not know, at any point, is
 * whether an answer was right. The server records the verdict and does not send
 * it back — not per question, not in the readout — because this is a selection
 * round and telling 900 people the answer key while the sections are still open
 * would end the event.
 *
 * ── The two-beat pick ───────────────────────────────────────────────────────
 * Clicking an option SELECTS it. Nothing is committed. The pick is locked when
 * Continue is pressed, or when the ten seconds run out with something selected —
 * so a misclick is recoverable right up to the deadline, and the deadline is not
 * negotiable.
 *
 * ── Whose clock ─────────────────────────────────────────────────────────────
 * The deadline is a server timestamp, and the countdown drawn on screen is a
 * rendering of it corrected for the offset between the two clocks. A device with
 * a wrong system time therefore still gets exactly ten seconds, and moving the
 * system clock does not buy any. The server re-checks the deadline when the lock
 * lands, so the countdown is a drawing of the rule rather than the rule.
 *
 * ── One request a question ──────────────────────────────────────────────────
 * A lock returns the NEXT question with it, already served and stamped. This used
 * to be two calls — lock, then ask for the next — which on event wifi cost over
 * two seconds of blank panel out of a ten-second budget, and gave the run two
 * places to fail between one question and the next instead of one.
 *
 * ── Failing without stranding anyone ────────────────────────────────────────
 * A lock that cannot be delivered is retried with backoff while the run holds
 * still in `locking`, and it is NEVER retried by bouncing back to `question`: the
 * deadline has usually passed by then, so the countdown would fire another commit
 * immediately and the tab would hammer the API in a loop. Only a refusal the
 * server means as final — the section is closed, the quiz is stopped — ends the
 * run, and each of those has its own screen.
 */
export type SectionPhase = 'question' | 'locking' | 'finishing' | 'result';

export interface SectionRunState {
  phase: SectionPhase;
  question: PublicQuestion | null;
  index: number;
  total: number;
  /** Locked so far, from the server. Drives the progress rail. */
  answered: number;
  selected: number | null;
  /** Whole seconds left on the live question, for the readout. */
  secondsLeft: number;
  /** 0…1 of the budget remaining, for the ring. */
  fraction: number;
  isLast: boolean;
  finish: FinishResponse | null;
  error: string | null;
  /** True while a delivery is being retried, so the panel can say so. */
  retrying: boolean;
  /** Set when the run cannot continue. The renderer offers a reload. */
  fatal: boolean;
  select: (option: number) => void;
  /** Locks the current selection. No-op unless a question is live. */
  commit: () => void;
}

/** How often the countdown re-renders. 10 Hz is smooth for a bar and cheap. */
const TICK_MS = 100;
/** Backoff for a lock or a finish that could not be delivered, in ms. */
const RETRY_BACKOFF = [400, 900, 1800, 3200, 5000];

/** True for a failure that is worth trying again: a flaky network, not a refusal. */
function isTransient(err: unknown): boolean {
  if (!(err instanceof QuizApiError)) return true;
  if (err.code === 'rate-limited') return true;
  // status 0 is "never reached the server at all".
  return err.status === 0 || err.status >= 500;
}

export function useSection(run: SectionRunResponse): SectionRunState {
  const sectionId = run.section.id;
  const questions = run.questions;
  const total = questions.length;
  const budgetMs = run.section.secondsPerQuestion * 1000;

  const [serve, setServe] = useState<ServeResponse | null>(run.serve);
  const [answered, setAnswered] = useState(run.section.answered);
  const [selected, setSelected] = useState<number | null>(null);
  const [phase, setPhase] = useState<SectionPhase>(run.serve ? 'question' : 'finishing');
  const [finish, setFinish] = useState<FinishResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Guards a second commit landing while the first is in the air — a click on
  // Continue at the same instant the clock expires would otherwise post twice.
  const inFlight = useRef(false);
  // The live selection, read by the timeout path. State would be stale inside the
  // interval closure.
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;
  // Every pending timer, so unmounting mid-retry cannot fire into a dead tree.
  const timers = useRef<number[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(id => window.clearTimeout(id));
      timers.current = [];
    };
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current = timers.current.filter(t => t !== id);
      if (alive.current) fn();
    }, ms);
    timers.current.push(id);
  }, []);

  /**
   * Offset between the two clocks, measured from the `now` the server sent with
   * the serve. Positive when the server is ahead.
   */
  const offsetRef = useRef(0);
  const applyServe = useCallback((next: ServeResponse | null) => {
    if (next) offsetRef.current = Date.parse(next.now) - Date.now();
    setServe(next);
    setSelected(null);
  }, []);
  // The serve handed over at mount carries its own `now` too.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    if (run.serve) offsetRef.current = Date.parse(run.serve.now) - Date.now();
  }

  const index = useMemo(
    () => (serve ? Math.max(0, questions.findIndex(q => q.id === serve.qId)) : Math.min(answered, total - 1)),
    [answered, questions, serve, total]
  );
  const question = serve ? (questions[index] ?? null) : null;
  const isLast = index >= total - 1;

  const deadlineMs = serve ? Date.parse(serve.deadlineAt) - offsetRef.current : 0;
  const remainingMs = serve ? Math.max(0, deadlineMs - nowMs) : 0;

  /**
   * Closes the section out. Retried on a transient failure, because a section
   * that never finishes is a section that is never ranked — strictly worse for
   * the participant than any error message.
   */
  const close = useCallback(
    (attempt = 0) => {
      setPhase('finishing');
      quizApi
        .finish(sectionId)
        .then(payload => {
          if (!alive.current) return;
          setError(null);
          setRetrying(false);
          setFinish(payload);
          setPhase('result');
          track('section_complete', { section_id: sectionId, score: payload.score, seconds: payload.seconds });
        })
        .catch((err: unknown) => {
          if (!alive.current) return;
          const wait = RETRY_BACKOFF[attempt];
          if (isTransient(err) && wait !== undefined) {
            setRetrying(true);
            setError('Saving your score…');
            later(() => close(attempt + 1), wait);
            return;
          }
          setRetrying(false);
          setError(
            err instanceof QuizApiError
              ? `${err.message} Your answers are saved; reload to see your score.`
              : 'Could not close out this section. Your answers are saved — reload the page.'
          );
          setFatal(true);
        });
    },
    [later, sectionId]
  );

  /** Asks the server where the run actually is. Used after an ambiguous failure. */
  const resync = useCallback(
    (attempt = 0) => {
      quizApi
        .serve(sectionId)
        .then(({ serve: next }) => {
          if (!alive.current) return;
          setError(null);
          setRetrying(false);
          applyServe(next);
          if (next) setPhase('question');
          else close();
        })
        .catch((err: unknown) => {
          if (!alive.current) return;
          if (err instanceof QuizApiError && (err.code === 'quiz-stopped' || err.code === 'quiz-not-started')) {
            close();
            return;
          }
          const wait = RETRY_BACKOFF[attempt];
          if (isTransient(err) && wait !== undefined) {
            setRetrying(true);
            setError('Reconnecting…');
            later(() => resync(attempt + 1), wait);
            return;
          }
          setRetrying(false);
          setError('Lost the thread of this section. Reload the page — nothing you answered is lost.');
          setFatal(true);
        });
    },
    [applyServe, close, later, sectionId]
  );

  /**
   * Locks whatever is selected and moves on. Called by Continue and by the
   * deadline, and the two are the same act — which is the point: a timeout is a
   * lock with whatever was on screen, not a special case.
   */
  const send = useCallback(
    (qId: string, choice: number | null, attempt: number) => {
      quizApi
        .lock(sectionId, qId, choice)
        .then(res => {
          if (!alive.current) return;
          inFlight.current = false;
          setError(null);
          setRetrying(false);
          setAnswered(res.answered);
          track('question_locked', {
            section_id: sectionId,
            answered: res.answered,
            timed_out: res.expired || choice === null
          });
          // The next question came back with the lock. No second round trip.
          if (res.serve) {
            applyServe(res.serve);
            setPhase('question');
            return;
          }
          applyServe(null);
          close();
        })
        .catch((err: unknown) => {
          if (!alive.current) return;

          // The organisers stopped the quiz. The lock route itself is never gated,
          // so what was just answered is recorded either way; close the section so
          // it is ranked rather than left half-open.
          if (err instanceof QuizApiError && (err.code === 'quiz-stopped' || err.code === 'quiz-not-started')) {
            inFlight.current = false;
            close();
            return;
          }
          // Already landed — another tab, or a retry whose first attempt actually
          // arrived. Ask the server where we are rather than guessing.
          if (err instanceof QuizApiError && (err.code === 'already-answered' || err.code === 'not-served')) {
            inFlight.current = false;
            resync();
            return;
          }
          if (err instanceof QuizApiError && (err.code === 'section-done' || err.code === 'section-locked')) {
            inFlight.current = false;
            setRetrying(false);
            setError(err.message);
            setFatal(true);
            return;
          }

          const wait = RETRY_BACKOFF[attempt];
          if (isTransient(err) && wait !== undefined) {
            // Stay in `locking`. Bouncing back to `question` here is what would
            // put the countdown — whose deadline has almost certainly passed — into
            // a commit loop against a server that is already struggling.
            setRetrying(true);
            setError('Connection is slow. Still saving that answer…');
            later(() => send(qId, choice, attempt + 1), wait);
            return;
          }

          inFlight.current = false;
          setRetrying(false);
          setError(
            err instanceof QuizApiError ? err.message : 'Could not record that answer. Reload the page.'
          );
          setFatal(true);
        });
    },
    [applyServe, close, later, resync, sectionId]
  );

  const commit = useCallback(() => {
    if (inFlight.current || phase !== 'question' || !serve) return;
    inFlight.current = true;
    setPhase('locking');
    setError(null);
    send(serve.qId, selectedRef.current, 0);
  }, [phase, send, serve]);

  // The tick, and the deadline with it. Re-armed per question because `serve`
  // changes; not running at all during a lock, a finish, or the readout, which is
  // what keeps a failed delivery from being retried by the clock.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (phase !== 'question' || !serve) return;
    const deadline = Date.parse(serve.deadlineAt);
    const due = () => Date.now() >= deadline - offsetRef.current;

    setNowMs(Date.now());
    if (due()) {
      commitRef.current();
      return;
    }
    const id = window.setInterval(() => {
      setNowMs(Date.now());
      if (due()) {
        window.clearInterval(id);
        commitRef.current();
      }
    }, TICK_MS);

    // A backgrounded tab has its timers throttled to about once a second, and a
    // sleeping device stops them entirely. Checking on the way back means a
    // returning participant's question locks at once instead of after the next
    // tick — and the server has already expired it regardless, so agreeing
    // quickly is the honest thing to draw.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setNowMs(Date.now());
      if (due()) commitRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, serve]);

  // An attempt reopened with nothing left to serve is a section abandoned after
  // its last question. Close it out rather than showing an empty panel.
  const closedOnMount = useRef(false);
  useEffect(() => {
    if (run.serve || closedOnMount.current) return;
    closedOnMount.current = true;
    close();
  }, [close, run.serve]);

  const select = useCallback(
    (option: number) => {
      if (phase !== 'question') return;
      setSelected(prev => (prev === option ? null : option));
    },
    [phase]
  );

  return {
    phase,
    question,
    index,
    total,
    answered,
    selected,
    secondsLeft: Math.ceil(remainingMs / 1000),
    fraction: budgetMs ? remainingMs / budgetMs : 0,
    isLast,
    finish,
    error,
    retrying,
    fatal,
    select,
    commit
  };
}
