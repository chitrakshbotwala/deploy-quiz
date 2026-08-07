'use client';

import { useCallback, useEffect, useState } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { QuizApiError, quizApi } from '@/lib/quizApi';
import type { StartResponse } from '@/lib/quizApi';
import Starfield from '@/components/Starfield';
import Nav from '@/components/Nav';
import ContextMenu from '@/components/ContextMenu';
import RunGate from './RunGate';
import QuizRun from './QuizRun';

/**
 * /quiz — the shell.
 *
 * Everything that outlives a run lives here: the starfield, the nav, the frame.
 * Everything that belongs to one run lives in QuizRun, which is only mounted
 * once the server has opened a run and handed back a signed cookie. That split
 * is what lets `useQuiz` seed itself straight from the server's state in a
 * `useState` initialiser instead of syncing to it in an effect — by the time it
 * mounts, the run is a fact.
 *
 * On load this asks the server whether the cookie in hand already names a run.
 * A refresh, a locked phone, or a closed tab therefore returns to the question
 * it left, because the picks are rows in a table rather than state in a hook.
 */
type Boot =
  | { kind: 'loading' }
  | { kind: 'gate' }
  | { kind: 'run'; run: StartResponse };

export default function QuizApp() {
  const isMobile = useIsMobile();
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  // Served by the API rather than duplicated into NEXT_PUBLIC_ variables, so the gate
  // and the route that rejects it can never disagree about which accounts count,
  // and rotating the client id needs no frontend rebuild.
  const [emailDomains, setEmailDomains] = useState<string[]>([]);
  const [googleClientId, setGoogleClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A used email is a dead end, not a retry: the form stays disabled so the
  // visitor is not invited to keep trying variations of their own address.
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let live = true;
    quizApi
      .boot()
      .then(({ run, emailDomains: domains, googleClientId: clientId }) => {
        if (!live) return;
        setEmailDomains(domains);
        setGoogleClientId(clientId);
        setBoot(run ? { kind: 'run', run } : { kind: 'gate' });
      })
      .catch(() => {
        // The resume probe failing must not block the quiz — fall through to the
        // gate, where /run/start will surface any real outage with a message.
        if (live) setBoot({ kind: 'gate' });
      });
    return () => {
      live = false;
    };
  }, []);

  const start = useCallback((credential: string) => {
    setBusy(true);
    setError(null);
    quizApi
      .start({ credential })
      .then(run => setBoot({ kind: 'run', run }))
      .catch((err: unknown) => {
        if (err instanceof QuizApiError) {
          setError(err.message);
          if (err.code === 'already-ran') setBlocked(true);
        } else {
          setError('Could not reach the server. Try again in a moment.');
        }
      })
      .finally(() => setBusy(false));
  }, []);

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-space text-gray-100">
      {/* Wrapped rather than dropped in as its own fixed layer: Starfield's
          standalone mode sits at z-index -1, which puts it BEHIND this
          container's own `bg-space` and renders it invisible. Same wrapper
          pattern SpaceBackground uses on the landing page. */}
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <Starfield fixed={false} count={isMobile ? 110 : 200} mobile={isMobile} />
      </div>
      <Nav />

      {boot.kind === 'loading' && (
        <main className="relative z-10 flex h-full items-center justify-center">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-white/35">Establishing link…</p>
        </main>
      )}

      {boot.kind === 'gate' && (
        <main className="relative z-10 h-full">
          <div className="absolute inset-0">
            <RunGate
              onCredential={start}
              busy={busy}
              error={error}
              blocked={blocked}
              emailDomains={emailDomains}
              googleClientId={googleClientId}
            />
          </div>
        </main>
      )}

      {boot.kind === 'run' && <QuizRun run={boot.run} />}

      <ContextMenu />
    </div>
  );
}
