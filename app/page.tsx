import QuizApp from '@/components/quiz/QuizApp';

/**
 * The only page. Everything below `QuizApp` is a client component — the run is
 * a WebGL scene, a keyboard handler and a cookie-backed state machine, none of
 * which the server can render ahead of time — so this file exists only to be the
 * route.
 *
 * `force-dynamic` keeps it out of the static export path. The page itself has no
 * server data, but prerendering it at build time would pull the client tree
 * through a Node render that immediately throws away its output, and the run
 * cannot be cached in any case.
 */
export const dynamic = 'force-dynamic';

export default function Page() {
  return <QuizApp />;
}
