import { useEffect, useState } from 'react';
import { formatSeconds, quizApi } from '@/lib/quizApi';
import type { LeaderboardResponse } from '@/lib/quizApi';

/**
 * The board, shown from the readout.
 *
 * Hairline rows in the same idiom as the answer log — a leaderboard is a log
 * too, and giving it cards would make it the loudest thing on a page whose
 * loudest thing is supposed to be the score. The visitor's own row is the only
 * one that gets an accent, which is the whole job of the component: showing them
 * where they landed, not making everyone else's row interesting.
 *
 * Ranks come from the server. Because the finished-run ordering is score first
 * and elapsed time second, a row's position here is exactly the position the
 * readout quoted.
 */
const ACCENT = '#ff9ffc';

export default function Leaderboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    quizApi
      .leaderboard(20)
      .then(res => live && setData(res))
      .catch(() => live && setError('Could not load the board.'));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(135% 105% at 50% 45%, transparent 52%, #00000059)' }}
      />
      <div className="relative z-10 flex h-full flex-col px-[clamp(1.5rem,6vw,7rem)] pb-[clamp(1.75rem,6vh,4rem)] pt-[clamp(5.5rem,13vh,8.5rem)]">
        <header className="shrink-0">
          <div className="flex items-baseline justify-between gap-6">
            <span
              data-warp="eyebrow"
              className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.42em] md:text-xs"
              style={{ color: ACCENT }}
            >
              Leaderboard
            </span>
            <span data-warp="eyebrow" className="font-mono text-[0.7rem] tracking-[0.3em] text-white/40 md:text-xs">
              {data ? `${String(data.total).padStart(2, '0')} runs` : '—'}
            </span>
          </div>
          <div
            data-warp="rule"
            className="mt-3 h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}, rgba(255,255,255,0.09))` }}
          />
        </header>

        <div className="quiz-scroll min-h-0 flex-1 overflow-y-auto py-[clamp(1.25rem,3.5vh,2.5rem)]">
          {error && (
            <p className="text-[0.875rem]" style={{ color: 'var(--color-signal-off)' }}>
              {error}
            </p>
          )}
          {!error && !data && (
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-white/35">Reading the board…</p>
          )}
          {data && data.rows.length === 0 && (
            <p className="max-w-[52ch] text-[0.9rem] leading-[1.6] text-white/55">
              Nobody has finished a run yet. You are about to be first.
            </p>
          )}
          {data && data.rows.length > 0 && (
            <ol className="max-w-[52rem]">
              {data.rows.map(row => (
                <li
                  key={`${row.rank}-${row.name}`}
                  data-warp="meta"
                  className="grid grid-cols-[3ch_1fr_auto_auto] items-baseline gap-x-4 border-t border-white/[0.09] py-3.5 last:border-b md:gap-x-8"
                  style={row.you ? { borderColor: `${ACCENT}55` } : undefined}
                >
                  <span
                    className="font-mono text-[0.8rem] tabular-nums"
                    style={{ color: row.you ? ACCENT : 'rgba(255,255,255,0.4)' }}
                  >
                    {String(row.rank).padStart(2, '0')}
                  </span>
                  <span
                    className="truncate text-[0.9rem] font-semibold md:text-base"
                    style={{ color: row.you ? ACCENT : 'rgba(255,255,255,0.9)' }}
                  >
                    {row.name}
                    {row.you && (
                      <span className="ml-2 font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/40">
                        you
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[0.8125rem] tabular-nums text-white/75 md:text-sm">
                    {String(row.score).padStart(2, '0')}/10
                  </span>
                  <span className="font-mono text-[0.8125rem] tabular-nums text-white/45 md:text-sm">
                    {formatSeconds(row.seconds)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="shrink-0">
          <div
            className="h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}66, rgba(255,255,255,0.08) 38%, transparent)` }}
          />
          <div data-warp="cta" className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-white/20 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              ← Your readout
            </button>
            <a
              href="/"
              className="rounded-full border border-white/20 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Back to the journey
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
