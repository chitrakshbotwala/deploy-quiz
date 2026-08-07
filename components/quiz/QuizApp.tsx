'use client';

import { useCallback, useEffect, useState } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { signOutFirebase, track, trackScreen } from '@/lib/firebase';
import { QuizApiError, quizApi } from '@/lib/quizApi';
import type { FinishResponse, SectionRunResponse, StateResponse } from '@/lib/quizApi';
import Starfield from '@/components/Starfield';
import Nav from '@/components/Nav';
import ContextMenu from '@/components/ContextMenu';
import SignInGate from './SignInGate';
import StageLadder from './StageLadder';
import SectionRun from './SectionRun';
import EliminatedPanel from './EliminatedPanel';

/**
 * The shell.
 *
 * Everything that outlives a section lives here: the starfield, the nav, the
 * frame, and the one piece of state the whole app is a function of — the ladder
 * the server hands back from /api/state. Every screen below is chosen from that
 * state rather than from a route, because the flow is not navigable: you are
 * where the server says you are, and a URL that claimed otherwise would be a
 * second, wrong implementation of the rules.
 *
 * A section is mounted only once the server has opened an attempt and served a
 * question, which is what lets `useSection` seed itself straight from that
 * response in a `useState` initialiser instead of syncing to it in an effect. By
 * the time it mounts, the run is a fact.
 */
type View =
  | { kind: 'loading' }
  | { kind: 'gate' }
  | { kind: 'ladder' }
  | { kind: 'eliminated'; stageIndex: number }
  | { kind: 'run'; run: SectionRunResponse };

export default function QuizApp() {
  const isMobile = useIsMobile();
  const [state, setState] = useState<StateResponse | null>(null);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busySection, setBusySection] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Chooses the screen for a given ladder. The eliminated page wins over the
   * ladder: a shut door needs its reason on screen, not a badge in a list. It is
   * shown once per load — `onBack` drops to the ladder and stays there — because
   * re-asserting it on every state refresh would trap someone who wants to look
   * at their own scores.
   */
  const landOn = useCallback((next: StateResponse, allowEliminated = true) => {
    setState(next);
    if (!next.user) {
      setView({ kind: 'gate' });
      return;
    }
    const eliminatedAt = next.stages.findIndex(s => s.status === 'eliminated');
    if (allowEliminated && eliminatedAt >= 0) {
      setView({ kind: 'eliminated', stageIndex: eliminatedAt });
      return;
    }
    setView({ kind: 'ladder' });
  }, []);

  useEffect(() => {
    let live = true;
    quizApi
      .state()
      .then(next => {
        if (live) landOn(next);
      })
      .catch(() => {
        // The probe failing must not block the quiz — fall through to the gate,
        // where signing in will surface any real outage with a message.
        if (live) setView({ kind: 'gate' });
      });
    return () => {
      live = false;
    };
  }, [landOn]);

  // One screen_view per screen. There are no route changes to hook: the whole
  // quiz is one URL.
  useEffect(() => {
    trackScreen(view.kind);
  }, [view.kind]);

  /**
   * While the quiz is not running, poll.
   *
   * A room of registered participants staring at "waiting for the organisers"
   * must not have to be told to refresh — the ask would be shouted over a hall and
   * half of them would miss it. Eight seconds is frequent enough to feel immediate
   * and slow enough that a thousand idle tabs are a trickle rather than a load.
   *
   * Only on the ladder, and only while waiting: a running quiz needs no poll,
   * because the state that matters then arrives with every lock.
   */
  useEffect(() => {
    if (view.kind !== 'ladder') return;
    if (!state || state.event.status === 'running') return;
    const waitingOn = state.event.status;
    const id = window.setInterval(() => {
      quizApi
        .event()
        .then(event => {
          // The cheap poll only carries the event. When it has not moved, patch it
          // in — the `now` it brings keeps any clock honest — and stop there. When
          // it HAS moved, the ladder is worth the nine reads it costs.
          if (event.status === waitingOn) {
            setState(current => (current ? { ...current, event } : current));
            return;
          }
          quizApi
            .state()
            .then(next => landOn(next, false))
            .catch(() => undefined);
        })
        .catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(id);
  }, [landOn, state, view.kind]);

  const signIn = useCallback(
    (idToken: string) => {
      setSigningIn(true);
      setError(null);
      quizApi
        .login(idToken)
        .then(next => {
          track('login');
          landOn(next);
        })
        .catch((err: unknown) => {
          setError(
            err instanceof QuizApiError ? err.message : 'Could not reach the server. Try again in a moment.'
          );
        })
        .finally(() => setSigningIn(false));
    },
    [landOn]
  );

  const signOut = useCallback(() => {
    void signOutFirebase();
    quizApi
      .logout()
      .catch(() => undefined)
      .finally(() => {
        setState(null);
        setView({ kind: 'gate' });
      });
  }, []);

  const startSection = useCallback((sectionId: string) => {
    setBusySection(sectionId);
    setError(null);
    quizApi
      .openSection(sectionId)
      .then(run => {
        track('section_start', { section_id: sectionId });
        setView({ kind: 'run', run });
      })
      .catch((err: unknown) => {
        setError(err instanceof QuizApiError ? err.message : 'Could not open that section.');
        // Whatever the refusal was, the ladder we are holding is out of date —
        // the server is the one that knows why.
        quizApi
          .state()
          .then(next => landOn(next, false))
          .catch(() => undefined);
      })
      .finally(() => setBusySection(null));
  }, [landOn]);

  /** From the readout. Re-reads the ladder so a freshly opened section appears. */
  const afterSection = useCallback(
    (_finish: FinishResponse) => {
      setView({ kind: 'loading' });
      quizApi
        .state()
        .then(next => landOn(next))
        .catch(() => {
          setError('Your section is recorded, but the page could not refresh. Reload it.');
          setView({ kind: 'ladder' });
        });
    },
    [landOn]
  );

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-space text-gray-100">
      {/* Wrapped rather than dropped in as its own fixed layer: Starfield's
          standalone mode sits at z-index -1, which puts it BEHIND this
          container's own `bg-space` and renders it invisible. */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <Starfield fixed={false} count={isMobile ? 110 : 200} mobile={isMobile} />
      </div>
      <Nav />

      {view.kind === 'loading' && (
        <main className="relative z-10 flex h-full items-center justify-center">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-white/35">Establishing link…</p>
        </main>
      )}

      {view.kind === 'gate' && (
        <main className="relative z-10 h-full">
          <div className="absolute inset-0">
            <SignInGate
              onToken={signIn}
              busy={signingIn}
              error={error}
              emailDomains={state?.emailDomains ?? []}
              event={state?.event ?? null}
              stageCount={state?.preview.stages ?? 2}
              sectionCount={state?.preview.sections ?? 3}
              secondsPerQuestion={state?.preview.secondsPerQuestion ?? 10}
            />
          </div>
        </main>
      )}

      {view.kind === 'ladder' && state?.user && (
        <main className="relative z-10 h-full">
          <div className="absolute inset-0">
            <StageLadder
              name={state.user.name}
              stages={state.stages}
              event={state.event}
              onStart={startSection}
              onSignOut={signOut}
              busySection={busySection}
              error={error}
            />
          </div>
        </main>
      )}

      {view.kind === 'eliminated' && state && (
        <main className="relative z-10 h-full">
          <div className="absolute inset-0">
            <EliminatedPanel
              stage={state.stages[view.stageIndex]}
              // The last stage's cut produces the finalists, so there is no next
              // stage to name — "not eligible for the finals" is the honest line.
              nextStageLabel={state.stages[view.stageIndex + 1]?.label ?? 'the finals'}
              onBack={() => setView({ kind: 'ladder' })}
            />
          </div>
        </main>
      )}

      {view.kind === 'run' && <SectionRun run={view.run} onDone={afterSection} />}

      <ContextMenu />
    </div>
  );
}
