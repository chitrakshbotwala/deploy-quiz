'use client';

import { useEffect } from 'react';

/**
 * The last line before a white screen.
 *
 * The quiz is one long-lived client tree — a WebGL scene, a countdown, a state
 * machine — and an unhandled render error in any of it would otherwise leave a
 * participant staring at nothing at all, mid-section, with no idea whether their
 * answers survived. They did: every lock is a row in Firestore before the client
 * hears about it, so the honest message here is "reload, you have not lost
 * anything", and reloading genuinely resumes the attempt at the same question with
 * the same deadline.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server-side digests are all a production build gives; log it so a report of
    // "it broke" can be matched to a line.
    console.error('[quiz] render error', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-space px-6 text-center">
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.42em]" style={{ color: '#ff9ffc' }}>
        Something broke
      </p>
      <h1 className="max-w-[28ch] text-[clamp(1.4rem,4vw,2.1rem)] font-extrabold leading-tight tracking-[-0.02em] text-white">
        This page fell over. Your answers did not.
      </h1>
      <p className="max-w-[52ch] text-[0.9rem] leading-[1.6] text-white/55">
        Every answer is recorded on the server the moment it is locked, so reloading puts you back on
        the same question with the same clock. If it happens twice, tell an organiser.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full px-6 py-2.5 text-sm font-semibold text-space transition-transform duration-200 hover:scale-105"
          style={{ backgroundColor: '#ff9ffc' }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-white/20 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/50 hover:text-white"
        >
          Reload the page
        </button>
      </div>
      {error.digest && (
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/25">
          ref {error.digest}
        </p>
      )}
    </main>
  );
}
