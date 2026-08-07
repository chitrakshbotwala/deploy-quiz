import { useCallback, useMemo, useState } from 'react';
import type { QuizQuestion } from '@/content/quizQuestions';

/**
 * Quiz engine. Pure state — it owns no DOM, no timing, and no animation, so the
 * two renderers (the WebGL asteroid field on desktop, the warp panels on mobile)
 * can share it verbatim and only differ in how they draw the same run.
 *
 * `phase` is the whole contract:
 *   question — waiting on a pick, options live
 *   feedback — a pick has landed, options locked, note showing, Next armed
 *   result   — run over
 *
 * `answers[i]` is the option index chosen for question i, or -1 for unanswered.
 * Kept as a full-length array rather than a growing list so the end-of-run
 * review can walk questions and answers in lockstep.
 */
export type QuizPhase = 'question' | 'feedback' | 'result';

export interface QuizState {
  index: number;
  phase: QuizPhase;
  picked: number | null;
  answers: number[];
  score: number;
  streak: number;
  bestStreak: number;
  startedAt: number;
  finishedAt: number | null;
  question: QuizQuestion;
  total: number;
  isLast: boolean;
  isCorrect: boolean;
  pick: (option: number) => void;
  next: () => void;
  restart: () => void;
}

export function useQuiz(questions: QuizQuestion[]): QuizState {
  const total = questions.length;
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<QuizPhase>('question');
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>(() => Array(total).fill(-1));
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  // Set on the first render of a run rather than on the first pick: the clock a
  // visitor perceives starts when the first question is readable, not when they
  // commit to an answer.
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const question = questions[index];
  const isLast = index === total - 1;
  const isCorrect = picked !== null && picked === question.answer;

  const pick = useCallback(
    (option: number) => {
      // Guarded rather than assumed: a keyboard shortcut and a click can both
      // arrive for the same question, and the second must not re-score it.
      if (phase !== 'question') return;
      const correct = option === questions[index].answer;
      setPicked(option);
      setPhase('feedback');
      setAnswers(prev => {
        const nextAnswers = prev.slice();
        nextAnswers[index] = option;
        return nextAnswers;
      });
      if (correct) {
        setScore(s => s + 1);
        setStreak(s => {
          const run = s + 1;
          setBestStreak(b => (run > b ? run : b));
          return run;
        });
      } else {
        setStreak(0);
      }
    },
    [index, phase, questions]
  );

  const next = useCallback(() => {
    if (phase !== 'feedback') return;
    if (index === total - 1) {
      setFinishedAt(Date.now());
      setPhase('result');
      return;
    }
    setIndex(i => i + 1);
    setPicked(null);
    setPhase('question');
  }, [index, phase, total]);

  const restart = useCallback(() => {
    setIndex(0);
    setPhase('question');
    setPicked(null);
    setAnswers(Array(total).fill(-1));
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setStartedAt(Date.now());
    setFinishedAt(null);
  }, [total]);

  return useMemo(
    () => ({
      index,
      phase,
      picked,
      answers,
      score,
      streak,
      bestStreak,
      startedAt,
      finishedAt,
      question,
      total,
      isLast,
      isCorrect,
      pick,
      next,
      restart
    }),
    [
      index,
      phase,
      picked,
      answers,
      score,
      streak,
      bestStreak,
      startedAt,
      finishedAt,
      question,
      total,
      isLast,
      isCorrect,
      pick,
      next,
      restart
    ]
  );
}
