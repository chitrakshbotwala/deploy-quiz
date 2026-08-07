import { useState } from 'react';
import { firebaseConfigured, signInWithGoogle, track } from '@/lib/firebase';
import type { EventState } from '@/lib/quizApi';

/**
 * The sign-in gate. One screen before question 01.
 *
 * Built in the same frame as the question panels — masthead rule, display
 * headline, telemetry rail — because it is the first stop on the run, not a modal
 * bolted in front of it. The button sits where the answer rows sit, so the eye
 * lands in the same place when the first question arrives behind it.
 *
 * Identity is not asserted by the visitor. Firebase runs the Google popup, and
 * the ID token it returns is verified server-side — signature, audience, provider
 * and email domain — before a document is written. There is deliberately no email
 * fallback: attempts are one per person per section, so an identity anyone can
 * type is an identity anyone can burn on someone else's behalf.
 *
 * The popup is opened from this component rather than from the shell because it
 * must be called synchronously inside a real click. A popup opened from a promise
 * chain that started somewhere else is blocked by every browser.
 */
const ACCENT = '#ff9ffc';

export interface SignInGateProps {
  /** Receives the Firebase ID token. The server does the verifying. */
  onToken: (idToken: string) => void;
  busy: boolean;
  error: string | null;
  /** Bare domains, no `@`. Empty means any Google account is accepted. */
  emailDomains: string[];
  /**
   * Whether the quiz is live. Sign-in does not depend on it — registration is
   * open before the event and stays open during it — but saying so here stops
   * someone signing in, seeing a waiting screen, and assuming they broke it.
   */
  event: EventState | null;
  stageCount: number;
  sectionCount: number;
  secondsPerQuestion: number;
}

export default function SignInGate({
  onToken,
  busy,
  error,
  emailDomains,
  event,
  stageCount,
  sectionCount,
  secondsPerQuestion
}: SignInGateProps) {
  const [popupError, setPopupError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const domain = emailDomains[0] ?? '';

  const signIn = () => {
    if (busy || opening) return;
    setOpening(true);
    setPopupError(null);
    track('login_start');
    signInWithGoogle(domain || undefined)
      .then(token => onToken(token))
      .catch((err: unknown) => {
        const code = (err as { code?: string } | null)?.code ?? '';
        // A closed popup is not an error worth a red line — the visitor did it on
        // purpose. A blocked one is, and it needs different advice.
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          setPopupError(null);
        } else if (code === 'auth/popup-blocked') {
          setPopupError('Your browser blocked the sign-in window. Allow pop-ups for this page and try again.');
        } else if (code === 'auth/unauthorized-domain') {
          setPopupError('This domain is not authorised in the Firebase project. Tell the organisers.');
        } else {
          setPopupError('Google sign-in did not complete. Check your connection and try again.');
        }
      })
      .finally(() => setOpening(false));
  };

  const shown = popupError ?? error;
  const label = 'font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/55 md:text-[0.6875rem]';
  const working = busy || opening;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div data-warp="blobs" className="pointer-events-none absolute inset-0">
        <div
          className="blob-a absolute left-[-6%] top-[-8%] h-[46vw] w-[46vw] rounded-full blur-xl"
          style={{ background: `radial-gradient(circle, ${ACCENT}, transparent 70%)`, opacity: 0.34 }}
        />
        <div
          className="blob-c absolute bottom-[-12%] right-[-4%] h-[42vw] w-[42vw] rounded-full blur-xl"
          style={{ background: `radial-gradient(circle, ${ACCENT}, transparent 72%)`, opacity: 0.26 }}
        />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(135% 105% at 50% 45%, transparent 52%, #00000059)' }}
      />

      <div className="quiz-scroll relative z-10 flex h-full flex-col overflow-y-auto px-[clamp(1.5rem,6vw,7rem)] pb-[clamp(1.75rem,6vh,4rem)] pt-[clamp(5.5rem,13vh,8.5rem)]">
        <header className="shrink-0">
          <div className="flex items-baseline justify-between gap-6">
            <span
              data-warp="eyebrow"
              className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.42em] md:text-xs"
              style={{ color: ACCENT }}
            >
              Pre-flight
            </span>
            <span data-warp="eyebrow" className="font-mono text-[0.7rem] tracking-[0.3em] text-white/40 md:text-xs">
              Sign in
            </span>
          </div>
          <div
            data-warp="rule"
            className="mt-3 h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}33 42%, rgba(255,255,255,0.09))` }}
          />
        </header>

        <div className="flex flex-1 items-center py-[clamp(1.25rem,3.5vh,2.5rem)]">
          <div className="w-full md:max-w-[46rem]">
            <h2 className="overflow-hidden pb-[0.34em] -mb-[0.2em] text-[clamp(1.6rem,3.4vw,3.1rem)] font-extrabold leading-[0.98] tracking-[-0.025em] text-white">
              <span data-warp="title" className="block text-balance">
                Two rounds. Ten seconds a question.
              </span>
            </h2>
            <p
              data-warp="tagline"
              className="mt-2.5 font-mono text-[0.7rem] uppercase tracking-[0.32em]"
              style={{ color: ACCENT }}
            >
              {domain ? `Sign in with your @${domain} account` : 'Sign in with any Google account'}
            </p>

            {event && event.status !== 'running' && (
              <p data-warp="tagline" className="mt-4 max-w-[54ch] text-[0.875rem] leading-[1.6] text-white/60">
                {event.status === 'stopped'
                  ? 'The quiz has ended. You can still sign in to see your own sections.'
                  : 'The quiz has not started yet — sign in now and you are registered. Your rounds open the moment the organisers start, with no refresh needed.'}
              </p>
            )}

            <div className="mt-[clamp(1.5rem,4vh,2.5rem)]">
              <button
                data-warp="option"
                type="button"
                onClick={signIn}
                disabled={working || !firebaseConfigured}
                aria-busy={working}
                className="inline-flex items-center gap-3 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#1f1f1f] transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] enabled:hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {/* Google's own mark, inline. Four paths, no network request, and
                    the wording is the one their brand terms require. */}
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
                  <path
                    fill="#4285F4"
                    d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
                  />
                  <path
                    fill="#34A853"
                    d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A8.99 8.99 0 0 0 9 18z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.32z"
                  />
                  <path
                    fill="#EA4335"
                    d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A8.99 8.99 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"
                  />
                </svg>
                {working ? 'Signing in…' : 'Sign in with Google'}
              </button>

              {!firebaseConfigured && (
                <p className="mt-4 max-w-[52ch] text-[0.8125rem] leading-[1.5]" style={{ color: 'var(--color-signal-off)' }}>
                  This build has no Firebase web config. Set the NEXT_PUBLIC_FIREBASE_* variables and rebuild.
                </p>
              )}

              {/* Reserved whether or not it is filled, so nothing below jumps when
                  a rejection arrives. */}
              <div className="mt-4 min-h-[3rem]" aria-live="polite">
                {shown && (
                  <p className="max-w-[52ch] text-[0.8125rem] leading-[1.5]" style={{ color: 'var(--color-signal-off)' }}>
                    {shown}
                  </p>
                )}
              </div>

              <p data-warp="meta" className="mt-2 max-w-[58ch] text-[0.75rem] leading-[1.6] text-white/40">
                {domain
                  ? `Only @${domain} accounts can play, and each account gets one attempt at each section. `
                  : 'Any Google account can play, and each account gets one attempt at each section. '}
                Signed out, or on a different device? Sign in with the same Google account and you
                pick up exactly where you left off — the account is the identity, not the browser.
                Answers are not shown during the rounds, and no leaderboard is public. Your email
                stays with the GDG KIIT organisers and is used only to verify entries for this event.
              </p>
            </div>
          </div>
        </div>

        <footer className="shrink-0">
          <div className="h-px w-full bg-white/[0.08]" />
          <dl className="mt-4 grid grid-cols-2 gap-x-6 md:mt-5 md:grid-cols-4 md:gap-x-10">
            {[
              {
                label: 'Status',
                value:
                  event?.status === 'running' ? 'Live' : event?.status === 'stopped' ? 'Ended' : 'Not started'
              },
              { label: 'Rounds', value: String(stageCount).padStart(2, '0') },
              { label: 'Sections', value: String(sectionCount).padStart(2, '0') },
              { label: 'Per question', value: `${secondsPerQuestion}s` }
            ].map(row => (
              <div key={row.label} data-warp="meta">
                <dt className={label}>{row.label}</dt>
                <dd className="mt-1.5 font-mono text-[0.9375rem] tabular-nums text-white/90 md:text-base">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </footer>
      </div>
    </div>
  );
}
