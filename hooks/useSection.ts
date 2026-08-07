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
  /** Set when the run cannot continue — the section closed under us, say. */
  fatal: boolean;
  select: (option: number) => void;
  /** Locks the current selection. No-op unless a question is live. */
  commit: () => void;
}

/** How often the countdown re-renders. 10 Hz is smooth for a ring and cheap. */
const TICK_MS = 100;

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
  const [fatal, setFatal] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Guards a second commit landing while the first is in the air — a click on
  // Continue at the same instant the clock expires would otherwise post twice.
  const inFlight = useRef(false);
  // The live selection, read by the timeout path. State would be stale inside the
  // interval closure.
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;

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

  const close = useCallback(() => {
    setPhase('finishing');
    quizApi
      .finish(sectionId)
      .then(payload => {
        setFinish(payload);
        setPhase('result');
        track('section_complete', { section_id: sectionId, score: payload.score, seconds: payload.seconds });
      })
      .catch((err: unknown) => {
        setError(
          err instanceof QuizApiError ? err.message : 'Could not close out this section. Reload the page.'
        );
      });
  }, [sectionId]);

  /**
   * Locks whatever is selected and moves on. Called by Continue and by the
   * deadline, and the two are the same act — which is the point: a timeout is a
   * lock with whatever was on screen, not a special case.
   */
  const commit = useCallback(() => {
    if (inFlight.current || phase !== 'question' || !serve) return;
    inFlight.current = true;
    setPhase('locking');
    setError(null);
    const choice = selectedRef.current;

    quizApi
      .lock(sectionId, serve.qId, choice)
      .then(res => {
        setAnswered(res.answered);
        track('question_locked', {
          section_id: sectionId,
          answered: res.answered,
          timed_out: res.expired || choice === null
        });
        if (!res.nextQId) {
          applyServe(null);
          close();
          return;
        }
        return quizApi.serve(sectionId).then(({ serve: next }) => {
          applyServe(next);
          if (next) setPhase('question');
          else close();
        });
      })
      .catch((err: unknown) => {
        // The organisers stopped the quiz while this section was open. The lock
        // itself is never gated, so whatever was just answered is already
        // recorded; what fails is the request for the NEXT question. Close the
        // section out rather than stranding the participant on a question that is
        // already locked — an unfinished section is not ranked at all, which would
        // be a far worse outcome than one closed early.
        if (err instanceof QuizApiError && (err.code === 'quiz-stopped' || err.code === 'quiz-not-started')) {
          close();
          return;
        }
        if (err instanceof QuizApiError && (err.code === 'already-answered' || err.code === 'not-served')) {
          // Another tab, or a retry that actually landed the first time. Ask the
          // server where we are rather than guessing.
          return quizApi
            .serve(sectionId)
            .then(({ serve: next }) => {
              applyServe(next);
              if (next) setPhase('question');
              else close();
            })
            .catch(() => {
              setError('Lost the thread of this section. Reload the page.');
              setFatal(true);
            });
        }
        if (err instanceof QuizApiError && (err.code === 'section-done' || err.code === 'section-locked')) {
          setError(err.message);
          setFatal(true);
          return;
        }
        setError(err instanceof QuizApiError ? err.message : 'Could not record that answer.');
        setPhase('question');
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [applyServe, close, phase, sectionId, serve]);

  // The tick, and the deadline with it. One interval for the whole run: it is
  // re-armed per question because `serve` changes, and it is not running at all
  // during a lock, a finish, or the readout.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (phase !== 'question' || !serve) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= Date.parse(serve.deadlineAt) - offsetRef.current) {
        window.clearInterval(id);
        commitRef.current();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [phase, serve]);

  // An attempt reopened with nothing left to serve is a section that was
  // abandoned after its last question. Close it out rather than showing an empty
  // panel.
  useEffect(() => {
    if (!run.serve) close();
    // Deliberately once, on mount: `close` is stable and re-running this would
    // re-post finish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    fatal,
    select,
    commit
  };
}
