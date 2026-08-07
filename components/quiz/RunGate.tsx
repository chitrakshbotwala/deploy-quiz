import { useEffect, useRef, useState } from 'react';
import { loadGoogleSignIn } from '@/lib/googleSignIn';

/**
 * The sign-in gate. One screen before question 01.
 *
 * Built in the same frame as the question panels — masthead rule, display
 * headline, telemetry rail — because it is the first stop on the run, not a
 * modal bolted in front of it. The button sits exactly where the answer rows
 * sit, so the eye lands in the same place when Q01 warps in behind it.
 *
 * This used to be a name/email/roll form, and the form was the weak point: it
 * checked that a typed string ended in "@kiit.ac.in", which proves nothing about
 * who typed it. Since attempts are one per person and enforced hard, that meant
 * anyone could sign up as a classmate and destroy the only run that classmate
 * would ever get — and institute addresses are roll-number derived, so it was
 * scriptable. Google hands over a signed token instead, and the server checks
 * the `hd` claim, so an account cannot be asserted, only proved.
 *
 * There is deliberately no email fallback. One would reopen the hole entirely.
 */
const ACCENT = '#ff9ffc';

export interface RunGateProps {
  /** Receives the Google ID token. The server does the verifying. */
  onCredential: (credential: string) => void;
  busy: boolean;
  error: string | null;
  /** Set when the account has already used its run — a dead end, not a retry. */
  blocked: boolean;
  /** Workspace domain the run is restricted to, for the copy. May be empty. */
  emailDomains: string[];
  googleClientId: string;
}

export default function RunGate({
  onCredential,
  busy,
  error,
  blocked,
  emailDomains,
  googleClientId
}: RunGateProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const domain = emailDomains[0] ?? '';

  // The callback is held in a ref so the GSI button, which is initialised once
  // and lives outside React, always calls the current handler rather than the
  // one captured on first render.
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    if (!googleClientId) return;
    let live = true;
    loadGoogleSignIn()
      .then(id => {
        if (!live || !buttonRef.current) return;
        id.initialize({
          client_id: googleClientId,
          callback: res => {
            if (res.credential) handler.current(res.credential);
          },
          // No auto-select and no One Tap: this is a deliberate, scored action,
          // and silently signing someone in with a previously used account is
          // the wrong default when the account gets exactly one attempt.
          auto_select: false,
          cancel_on_tap_outside: true
        });
        id.disableAutoSelect();
        id.renderButton(buttonRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          logo_alignment: 'left',
          width: 260
        });
      })
      .catch(() => {
        if (live) {
          setLoadError(
            'Google sign-in could not load. Check for a blocker or a network filter, then reload.'
          );
        }
      });
    return () => {
      live = false;
    };
  }, [googleClientId]);

  const label = 'font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/55 md:text-[0.6875rem]';
  const shown = loadError ?? error;

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
              00 / 10
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
                Ten questions. One run each.
              </span>
            </h2>
            <p
              data-warp="tagline"
              className="mt-2.5 font-mono text-[0.7rem] uppercase tracking-[0.32em]"
              style={{ color: ACCENT }}
            >
              {domain ? `Sign in with your @${domain} account` : 'Sign in to the board'}
            </p>

            <div className="mt-[clamp(1.5rem,4vh,2.5rem)]">
              {/* GSI renders its own iframe-backed button here. It is left to
                  Google's own markup rather than restyled into the site's pill:
                  a hand-drawn "Sign in with Google" control is against their
                  brand terms, and more to the point it is the one control on the
                  page a visitor should recognise instantly from elsewhere. */}
              <div
                data-warp="option"
                ref={buttonRef}
                className={`min-h-[44px] ${busy || blocked ? 'pointer-events-none opacity-40' : ''}`}
                aria-busy={busy}
              />

              {busy && (
                <p className="mt-4 font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/35">
                  Opening the run…
                </p>
              )}

              {/* Reserved whether or not it is filled, so nothing below jumps
                  when a rejection arrives. */}
              <div className="mt-4 min-h-[3rem]" aria-live="polite">
                {shown && (
                  <p
                    className="max-w-[52ch] text-[0.8125rem] leading-[1.5]"
                    style={{ color: 'var(--color-signal-off)' }}
                  >
                    {shown}
                  </p>
                )}
              </div>

              <p data-warp="meta" className="mt-2 max-w-[58ch] text-[0.75rem] leading-[1.6] text-white/40">
                {domain ? `Only @${domain} accounts can play, and each one gets a single run. ` : ''}
                Your name appears on the public leaderboard. Your email stays with the GDG KIIT
                organisers, is used only to verify entries for this event, and is deleted afterwards.
              </p>
            </div>
          </div>
        </div>

        <footer className="shrink-0">
          <div className="h-px w-full bg-white/[0.08]" />
          <dl className="mt-4 grid grid-cols-3 gap-x-6 md:mt-5 md:gap-x-10">
            {[
              { label: 'Questions', value: '10' },
              { label: 'Attempts', value: '01' },
              { label: 'Time limit', value: 'None' }
            ].map(row => (
              <div key={row.label} data-warp="meta">
                <dt className={label}>{row.label}</dt>
                <dd className="mt-1.5 font-mono text-[0.9375rem] text-white/90 md:text-base">{row.value}</dd>
              </div>
            ))}
          </dl>
        </footer>
      </div>
    </div>
  );
}
