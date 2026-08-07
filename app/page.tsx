import QuizApp from '@/components/quiz/QuizApp';

/**
 * The only page. Everything below `QuizApp` is a client component — the run is a
 * WebGL scene, a keyboard handler and a state machine that lives in the tab — so
 * this file exists only to be the route.
 */
export default function Page() {
  return <QuizApp />;
}
