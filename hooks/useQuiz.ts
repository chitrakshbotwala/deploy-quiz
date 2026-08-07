import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QuizQuestion } from '@/content/quizQuestions';
import { QuizApiError, quizApi } from '@/lib/quizApi';
import type { AnsweredQuestion, FinishResponse, StartResponse } from '@/lib/quizApi';

/**
 * Quiz engine. Still pure of DOM, timing and animation, so the two renderers
 * (the WebGL asteroid field on desktop, the warp panels on mobile) share it
 * verbatim and only differ in how they draw the same run.
 *
 * What changed when the backend landed: this hook no longer knows any answers.
 * It posts a pick and is told whether it was right, by a server that has already
 * written the row. `score`, `streak` and the end-of-run readout are all values
 * the server computed — nothing here can be edited in devtools into a better
 * result, because nothing here is what the leaderboard reads.
 *
 * `phase` is still the whole contract:
 *   question — waiting on a pick, options live
 *   feedback — a pick has landed, options locked, note showing, Next armed
 *   result   — run over
 *
 * `pending` is the one new beat: the window between the click and the server's
 * verdict. It is short (same box, same datacentre) but it is not zero, and the
 * option rows must not look armed while it is open.
 */
export type QuizPhase = 'question' | 'feedback' | 'result';

export interface QuizState {
  index: number;
  phase: QuizPhase;
  picked: number | null;
  pending: boolean;
  /** Set when a pick could not be recorded. The panel shows it and re-arms. */
  error: string | null;
  /** Answers so far, in run order. Drives the readout's log. */
  answered: AnsweredQuestion[];
  score: number;
  streak: number;
  bestStreak: number;
  startedAt: number;
  /** Server readout. Null until the run closes. */
  finish: FinishResponse | null;
  question: QuizQuestion;
  total: number;
  isLast: boolean;
  /** Verdict for the live question, from the server. Null before a pick lands. */
  isCorrect: boolean | null;
  /** Correct option for the live question — only ever known after picking. */
  answer: number | null;
  note: string | null;
  pick: (option: number) => void;
  next: () => void;
}

function streakTail(answered: AnsweredQuestion[]): number {
  let run = 0;
  for (const a of answered) run = a.correct ? run + 1 : 0;
  return run;
}

function streakBest(answered: AnsweredQuestion[]): number {
  let best = 0;
  let run = 0;
  for (const a of answered) {
    run = a.correct ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

export function useQuiz(questions: QuizQuestion[], run: StartResponse): QuizState {
  const total = questions.length;

  // Seeded once from the run the shell handed us. A resumed run arrives with its
  // picks already in `run.answered`, so a refresh mid-quiz rebuilds the exact
  // state it left rather than starting over — and starting over would be
  // impossible anyway, since those questions are locked server-side.
  const [answered, setAnswered] = useState<AnsweredQuestion[]>(() => run.answered);
  const [index, setIndex] = useState(() => Math.min(run.answered.length, total - 1));
  const [phase, setPhase] = useState<QuizPhase>(() => (run.finished ? 'result' : 'question'));
  const [picked, setPicked] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finish, setFinish] = useState<FinishResponse | null>(() => run.finished);
  // Server clock, not Date.now(). The elapsed time on the rail and the time the
  // leaderboard ranks by are then the same measurement.
  const [startedAt] = useState(() => new Date(run.startedAt).getTime());

  const [score, setScore] = useState(() => run.answered.filter(a => a.correct).length);
  const [streak, setStreak] = useState(() => streakTail(run.answered));
  const [bestStreak, setBestStreak] = useState(() => streakBest(run.answered));

  // Guards a second click landing while the first is still in the air. `phase`
  // alone cannot do this: it does not move until the response arrives.
  const inFlight = useRef(false);
  // The readout is fetched the moment the last question is answered rather than
  // when Next is pressed, so it is already in hand by the time the warp lands.
  // It also means the run's recorded time stops at the final answer, not at
  // whenever the visitor got around to clicking through.
  const finishPromise = useRef<Promise<FinishResponse> | null>(null);

  const question = questions[index];
  const isLast = index === total - 1;

  const current = useMemo(
    () => answered.find(a => a.qId === question?.id) ?? null,
    [answered, question]
  );

  // A run that was closed on the server but never showed its readout — the tab
  // died between the last answer and the finish call. Close it out on mount.
  const [stranded] = useState(() => !run.finished && run.answered.length >= total);
  useEffect(() => {
    if (!stranded) return;
    let live = true;
    quizApi
      .finish()
      .then(payload => {
        if (!live) return;
        setFinish(payload);
        setPhase('result');
      })
      .catch(() => {
        if (live) setError('Could not close out your run. Reload to try again.');
      });
    return () => {
      live = false;
    };
  }, [stranded]);

  const pick = useCallback(
    (option: number) => {
      if (inFlight.current || phase !== 'question') return;
      inFlight.current = true;
      setPicked(option);
      setPending(true);
      setError(null);

      void quizApi
        .pick(question.id, option)
        .then(res => {
          const entry: AnsweredQuestion = {
            qId: question.id,
            choice: option,
            correct: res.correct,
            answer: res.answer,
            note: res.note
          };
          setAnswered(prev => [...prev.filter(a => a.qId !== entry.qId), entry]);
          setScore(res.score);
          setStreak(res.streak);
          setBestStreak(b => (res.streak > b ? res.streak : b));
          setPhase('feedback');
          if (index === total - 1) finishPromise.current = quizApi.finish();
        })
        .catch((err: unknown) => {
          const message =
            err instanceof QuizApiError ? err.message : 'Could not record that answer. Try again.';
          setError(message);
          // Re-arm rather than strand the visitor on a dead question. The one
          // case we cannot re-arm is a question the server says is already
          // answered, which means another tab got there first.
          if (!(err instanceof QuizApiError && err.code === 'already-answered')) setPicked(null);
        })
        .finally(() => {
          inFlight.current = false;
          setPending(false);
        });
    },
    [index, phase, question, total]
  );

  const next = useCallback(() => {
    if (phase !== 'feedback') return;
    if (index === total - 1) {
      const pendingFinish = finishPromise.current ?? quizApi.finish();
      finishPromise.current = pendingFinish;
      void pendingFinish
        .then(payload => {
          setFinish(payload);
          setPhase('result');
        })
        .catch(() => setError('Could not load your readout. Reload the page.'));
      return;
    }
    setIndex(i => i + 1);
    setPicked(null);
    setPhase('question');
    setError(null);
  }, [index, phase, total]);

  return useMemo(
    () => ({
      index,
      phase,
      picked,
      pending,
      error,
      answered,
      score,
      streak,
      bestStreak,
      startedAt,
      finish,
      question,
      total,
      isLast,
      isCorrect: current ? current.correct : null,
      answer: current ? current.answer : null,
      note: current ? current.note : null,
      pick,
      next
    }),
    [
      index,
      phase,
      picked,
      pending,
      error,
      answered,
      score,
      streak,
      bestStreak,
      startedAt,
      finish,
      question,
      total,
      isLast,
      current,
      pick,
      next
    ]
  );
}
