import { useEffect, useState } from 'react';
import type { EventState } from '@/lib/quizApi';

/**
 * Start, stop, and the clock since start.
 *
 * Its own component, with its own one-second tick, for a boring but real reason:
 * the board below it is up to a thousand rows, and hoisting the seconds into
 * `AdminApp` would re-render that table once a second for a two-digit change in
 * one corner of the screen.
 *
 * The clock reads from the server's `startedAt`, corrected by the offset between
 * the two clocks — an organiser's laptop with a wrong system time still sees the
 * real elapsed time, which matters when the number is being read out to a room.
 */
const ACCENT = '#ff9ffc';

function hms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function EventControls({
  event,
  onStart,
  onStop,
  busy
}: {
  event: EventState;
  onStart: (restart?: boolean) => void;
  onStop: () => void;
  busy: boolean;
}) {
  const offset = Date.parse(event.now) - Date.now();
  const startedMs = event.startedAt ? Date.parse(event.startedAt) - offset : null;
  const stoppedMs = event.stoppedAt ? Date.parse(event.stoppedAt) - offset : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Only ticks while it is counting. A stopped clock is a fixed number and does
    // not need a timer behind it.
    if (event.status !== 'running') return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [event.status, event.startedAt]);

  const elapsed =
    startedMs === null ? null : (event.status === 'running' ? now : (stoppedMs ?? now)) - startedMs;

  const light =
    event.status === 'running'
      ? 'var(--color-signal-ok)'
      : event.status === 'stopped'
        ? 'var(--color-signal-off)'
        : 'rgba(255,255,255,0.4)';

  return (
    <section className="mt-6 rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/45">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full ${event.status === 'running' ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: light }}
            />
            {event.status === 'running' ? 'Live' : event.status === 'stopped' ? 'Ended' : 'Not started'}
          </p>
          {/* The clock is the loudest thing in this box because it is the number an
              organiser is asked for out loud. */}
          <p className="mt-2 font-mono text-[clamp(1.75rem,5vw,2.75rem)] font-semibold tabular-nums leading-none text-white">
            {elapsed === null ? '—' : hms(elapsed)}
          </p>
          <p className="mt-2 font-mono text-[0.6875rem] tracking-[0.04em] text-white/40">
            {event.startedAt
              ? `Started ${new Date(event.startedAt).toLocaleTimeString()}${
                  event.stoppedAt ? ` · stopped ${new Date(event.stoppedAt).toLocaleTimeString()}` : ''
                }`
              : 'Participants can sign in and wait. No section opens until you start.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {event.status !== 'running' ? (
            <button
              type="button"
              onClick={() => onStart(false)}
              disabled={busy}
              className="rounded-full px-6 py-2.5 text-[0.875rem] font-semibold text-space transition-transform duration-200 enabled:hover:scale-105 disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-signal-ok)' }}
            >
              {event.status === 'stopped' ? 'Resume quiz' : 'Start quiz'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onStop}
              disabled={busy}
              className="rounded-full px-6 py-2.5 text-[0.875rem] font-semibold text-space transition-transform duration-200 enabled:hover:scale-105 disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-signal-off)' }}
            >
              Stop quiz
            </button>
          )}
          {/* Only offered where it is honest: once the clock has run, re-stamping it
              rewrites the record of when the event began. */}
          {event.status === 'stopped' && (
            <button
              type="button"
              onClick={() => onStart(true)}
              disabled={busy}
              className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/60 transition-colors hover:border-white/50 hover:text-white disabled:opacity-40"
            >
              Restart clock
            </button>
          )}
        </div>
      </div>

      <p className="mt-4 max-w-[80ch] text-[0.75rem] leading-[1.6] text-white/40">
        Stopping shuts the door on new sections and new questions. It deliberately does not cancel a
        question already on someone&apos;s screen — their lock and their section still close out, so
        nobody loses an answer they had already given. Resuming keeps the original start time; use{' '}
        <span style={{ color: ACCENT }}>Restart clock</span> only for a false start.
      </p>
    </section>
  );
}
