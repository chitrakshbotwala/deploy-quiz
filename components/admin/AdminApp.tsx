'use client';

import { useCallback, useEffect, useState } from 'react';
import { QuizApiError, adminApi, formatSeconds } from '@/lib/quizApi';
import type { AdminBoardResponse, AdminStagesResponse, EventState } from '@/lib/quizApi';
import EventControls from './EventControls';

/**
 * The leaderboard, and the only place one exists.
 *
 * No participant-facing route returns another participant's row, so this page is
 * the whole board: every entrant, ranked, with their address and their
 * per-section breakdown. It sits behind a single password compared in constant
 * time on the server, behind a six-an-hour per-IP limit, and the session it opens
 * is a signed cookie that ages out in four hours. Nothing here is fetched before
 * that cookie exists — the gate is the API's, not this component's, so a
 * hand-crafted request gets the same 401 the form does.
 *
 * The board is also where the event is started and stopped and where the two cuts
 * are taken. That is deliberate: both are acts with a room in front of them —
 * freezing a cut eliminates most of the field — and they belong on a button an
 * organiser presses while looking at the standings it will act on, not in a cron
 * job.
 */
const ACCENT = '#ff9ffc';

function Board({
  board,
  onCut,
  onClearCut,
  busy
}: {
  board: AdminBoardResponse;
  onCut: (stageId: string) => void;
  onClearCut: (stageId: string) => void;
  busy: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  // Default to just past the cut line: the row that matters most on this page is
  // the first one that did not make it.
  const visible = showAll ? board.rows : board.rows.slice(0, board.cutoff + 5);

  return (
    <section className="mt-10 first:mt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[1.1rem] font-semibold tracking-[-0.01em] text-white md:text-[1.3rem]">
          {board.label}
        </h2>
        <p className="font-mono text-[0.6875rem] tracking-[0.06em] text-white/45">
          {board.completed} finished · {board.started} started · cutoff {board.cutoff}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onCut(board.stageId)}
          disabled={busy}
          className="rounded-full px-5 py-2 text-[0.8125rem] font-semibold text-space transition-transform duration-200 enabled:hover:scale-105 disabled:opacity-40"
          style={{ backgroundColor: ACCENT }}
        >
          {board.cut ? `Re-take cut (top ${board.cutoff})` : `Freeze cut (top ${board.cutoff})`}
        </button>
        {board.cut && (
          <button
            type="button"
            onClick={() => onClearCut(board.stageId)}
            disabled={busy}
            className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/60 transition-colors hover:border-white/50 hover:text-white disabled:opacity-40"
          >
            Undo cut
          </button>
        )}
        <p className="font-mono text-[0.6875rem] tracking-[0.04em] text-white/45">
          {board.cut
            ? `Frozen ${new Date(board.cut.at).toLocaleString()} · ${board.cut.eligible} of ${board.cut.ranked} through`
            : 'Not frozen. The next round stays shut until it is.'}
        </p>
      </div>

      {/* Wide table, so it scrolls inside its own box rather than pushing the
          page sideways. */}
      <div className="quiz-scroll mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/45">
              <th className="border-b border-white/[0.09] py-2 pr-4 font-normal">#</th>
              <th className="border-b border-white/[0.09] py-2 pr-4 font-normal">Name</th>
              <th className="border-b border-white/[0.09] py-2 pr-4 font-normal">Email</th>
              <th className="border-b border-white/[0.09] py-2 pr-4 text-right font-normal">Score</th>
              <th className="border-b border-white/[0.09] py-2 pr-4 text-right font-normal">Time</th>
              {board.sectionIds.map(id => (
                <th key={id} className="border-b border-white/[0.09] py-2 pr-4 text-right font-normal">
                  {id}
                </th>
              ))}
              <th className="border-b border-white/[0.09] py-2 text-right font-normal">Cut</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              // The line itself, drawn on the row that sits on it. An organiser
              // reading this page is looking for exactly this boundary.
              const onTheLine = row.rank === board.cutoff;
              return (
                <tr
                  key={row.uid}
                  className="align-baseline"
                  style={onTheLine ? { boxShadow: `inset 0 -1px 0 ${ACCENT}88` } : undefined}
                >
                  <td className="border-b border-white/[0.06] py-2.5 pr-4 font-mono text-[0.75rem] tabular-nums text-white/45">
                    {row.rank}
                  </td>
                  <td className="border-b border-white/[0.06] py-2.5 pr-4 text-[0.875rem] font-semibold text-white/90">
                    {row.name}
                  </td>
                  <td className="border-b border-white/[0.06] py-2.5 pr-4 font-mono text-[0.75rem] text-white/50">
                    {row.email}
                  </td>
                  <td className="border-b border-white/[0.06] py-2.5 pr-4 text-right font-mono text-[0.8125rem] tabular-nums text-white/85">
                    {row.score}/{row.total}
                  </td>
                  <td className="border-b border-white/[0.06] py-2.5 pr-4 text-right font-mono text-[0.8125rem] tabular-nums text-white/55">
                    {formatSeconds(row.seconds)}
                  </td>
                  {row.sections.map((s, i) => (
                    <td
                      key={board.sectionIds[i]}
                      className="border-b border-white/[0.06] py-2.5 pr-4 text-right font-mono text-[0.75rem] tabular-nums text-white/45"
                    >
                      {s ? `${s.score}/${s.total} · ${formatSeconds(s.seconds)}` : '—'}
                    </td>
                  ))}
                  <td className="border-b border-white/[0.06] py-2.5 text-right font-mono text-[0.6875rem] uppercase tracking-[0.2em]">
                    {row.eligible === null ? (
                      <span className="text-white/25">—</span>
                    ) : row.eligible ? (
                      <span style={{ color: 'var(--color-signal-ok)' }}>in</span>
                    ) : (
                      <span style={{ color: 'var(--color-signal-off)' }}>out</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {board.rows.length === 0 && (
        <p className="mt-3 text-[0.875rem] text-white/45">Nobody has finished a section in this round yet.</p>
      )}
      {board.rows.length > visible.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.3em] text-white/45 hover:text-white"
        >
          Show all {board.rows.length}
        </button>
      )}
    </section>
  );
}

export default function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [data, setData] = useState<AdminStagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Start/stop only, so those two never disable the cut buttons or the table. */
  const [eventBusy, setEventBusy] = useState(false);

  /**
   * Reads the board. `quiet` refreshes underneath whatever the organiser is doing
   * — no spinner, no disabled buttons — which is what a background refresh after
   * start or stop wants: those already showed their result instantly.
   */
  const load = useCallback((quiet = false) => {
    if (!quiet) setBusy(true);
    adminApi
      .board()
      .then(res => {
        setData(res);
        setAuthed(true);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof QuizApiError && err.code === 'not-admin') setAuthed(false);
        // A failed quiet refresh is not worth a red line over a board that is
        // still on screen and still true.
        else if (!quiet) setError(err instanceof QuizApiError ? err.message : 'Could not load the board.');
      })
      .finally(() => {
        if (!quiet) setBusy(false);
      });
  }, []);

  useEffect(() => {
    // Probe first: an admin cookie from earlier in the evening should not have to
    // be retyped on every reload.
    adminApi
      .session()
      .then(({ admin }) => (admin ? load() : setAuthed(false)))
      .catch(() => setAuthed(false));
  }, [load]);

  /**
   * Keeps the board current while it is open.
   *
   * An organiser watching the room fill up should not have to press Refresh to find
   * out whether stage 1 is done. Thirty seconds, and only while the tab is actually
   * in front of someone: the board is not a cheap read — it is every standing and
   * every cut member for both stages, which at nine hundred participants is a few
   * thousand documents — so an admin page left open on a spare laptop overnight
   * should not keep paying for it.
   */
  useEffect(() => {
    if (!authed) return;
    const tick = () => {
      if (document.visibilityState === 'visible') load(true);
    };
    const id = window.setInterval(tick, 30_000);
    // Catch up immediately on returning to the tab, rather than up to 30s later.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [authed, load]);

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    adminApi
      .login(password)
      .then(() => {
        setPassword('');
        load();
      })
      .catch((err: unknown) => {
        setError(err instanceof QuizApiError ? err.message : 'Could not sign in.');
      })
      .finally(() => setBusy(false));
  };

  const cut = (stageId: string) => {
    // Eliminating most of the field is not an accident anyone should be able to
    // have. The confirm is the only modal in the app, and it earns it.
    const board = data?.boards.find(b => b.stageId === stageId);
    const ranked = board?.completed ?? 0;
    if (
      !window.confirm(
        `Freeze the cut for ${board?.label ?? stageId}?\n\n` +
          `${ranked} participants have finished it. The top ${board?.cutoff ?? '?'} advance; the rest are ` +
          `told their rank and shut out of the next round. You can undo this.`
      )
    ) {
      return;
    }
    setBusy(true);
    adminApi
      .cut(stageId)
      .then(() => load())
      .catch((err: unknown) => setError(err instanceof QuizApiError ? err.message : 'Could not freeze the cut.'))
      .finally(() => setBusy(false));
  };

  const clearCut = (stageId: string) => {
    if (!window.confirm('Undo this cut? The round reopens and nobody is eliminated.')) return;
    setBusy(true);
    adminApi
      .clearCut(stageId)
      .then(() => load())
      .catch((err: unknown) => setError(err instanceof QuizApiError ? err.message : 'Could not undo the cut.'))
      .finally(() => setBusy(false));
  };

  /**
   * Start and stop, applied the moment the server confirms them.
   *
   * The route returns the new event state, so it goes straight into `data` and the
   * status light and the clock turn over at once. The board is refreshed quietly
   * afterwards. The earlier version waited for that whole refetch — a second or
   * more with a thousand rows behind it — before anything on screen changed, which
   * made Stop feel like it had not registered and invited a second click.
   *
   * `eventBusy` is separate from `busy` so pressing Stop does not grey out the cut
   * buttons and the table underneath it.
   */
  const setEvent = (fn: () => Promise<EventState>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setEventBusy(true);
    setError(null);
    fn()
      .then(event => {
        setData(current => (current ? { ...current, event } : current));
        load(true);
      })
      .catch((err: unknown) =>
        setError(err instanceof QuizApiError ? err.message : 'Could not change the quiz state.')
      )
      .finally(() => setEventBusy(false));
  };

  const startQuiz = (restart = false) =>
    setEvent(
      () => adminApi.startQuiz(restart),
      restart
        ? 'Restart the clock? The recorded start time is overwritten. Only do this for a false start.'
        : undefined
    );

  const stopQuiz = () =>
    setEvent(
      () => adminApi.stopQuiz(),
      'Stop the quiz? No new section opens and no new question is served. Questions already on screen still lock normally.'
    );

  const signOut = () => {
    adminApi
      .logout()
      .catch(() => undefined)
      .finally(() => {
        setData(null);
        setAuthed(false);
      });
  };

  if (authed === null) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-space">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-white/35">Checking…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-space px-6">
        <form onSubmit={signIn} className="w-full max-w-[26rem]">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.42em]" style={{ color: ACCENT }}>
            Organisers only
          </p>
          <h1 className="mt-3 text-[clamp(1.5rem,4vw,2.2rem)] font-extrabold leading-[1.05] tracking-[-0.025em] text-white">
            Leaderboard
          </h1>
          <p className="mt-2 text-[0.8125rem] leading-[1.6] text-white/45">
            Participants never see a board. This page is the board.
          </p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Admin password"
            className="mt-6 w-full rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 font-mono text-sm text-white placeholder:text-white/25 focus:border-white/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !password}
            className="mt-4 w-full rounded-full px-6 py-3 text-sm font-semibold text-space transition-transform duration-200 enabled:hover:scale-[1.02] disabled:opacity-40"
            style={{ backgroundColor: ACCENT }}
          >
            {busy ? 'Checking…' : 'Open the board'}
          </button>
          <div className="mt-4 min-h-[2.5rem]" aria-live="polite">
            {error && (
              <p className="text-[0.8125rem] leading-[1.5]" style={{ color: 'var(--color-signal-off)' }}>
                {error}
              </p>
            )}
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-space px-[clamp(1.25rem,5vw,4rem)] py-[clamp(2rem,6vh,4rem)]">
      <div className="mx-auto max-w-[78rem]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.42em]" style={{ color: ACCENT }}>
              GDG KIIT · organisers
            </p>
            <h1 className="mt-2 text-[clamp(1.6rem,4vw,2.4rem)] font-extrabold leading-[1.05] tracking-[-0.025em] text-white">
              Leaderboard
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => load()}
              disabled={busy}
              className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/70 transition-colors hover:border-white/50 hover:text-white disabled:opacity-40"
            >
              {busy ? 'Reading…' : 'Refresh'}
            </button>
            <a
              href={adminApi.exportUrl}
              className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/70 transition-colors hover:border-white/50 hover:text-white"
            >
              Export CSV
            </a>
            <button
              type="button"
              onClick={signOut}
              className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/50 transition-colors hover:border-white/50 hover:text-white"
            >
              Lock
            </button>
          </div>
        </header>

        <div className="mt-3 h-px w-full" style={{ background: `linear-gradient(90deg, ${ACCENT}, rgba(255,255,255,0.09))` }} />

        {error && (
          <p className="mt-5 text-[0.8125rem]" style={{ color: 'var(--color-signal-off)' }}>
            {error}
          </p>
        )}

        {data?.event && (
          <EventControls event={data.event} onStart={startQuiz} onStop={stopQuiz} busy={eventBusy} />
        )}

        {data?.boards.map(board => (
          <Board key={board.stageId} board={board} onCut={cut} onClearCut={clearCut} busy={busy} />
        ))}
      </div>
    </main>
  );
}
