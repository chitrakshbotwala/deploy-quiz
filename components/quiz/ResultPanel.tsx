import { forwardRef, useEffect, useMemo, useState } from 'react';
import type { QuizQuestion } from '@/content/quizQuestions';
import { formatSeconds } from '@/lib/quizApi';
import type { FinishResponse } from '@/lib/quizApi';

/**
 * End of run. Same frame as the question panels (masthead rule, telemetry rail),
 * with the score standing in for the display headline.
 *
 * The score is a neon tube, struck once on arrival, using the same `--on`
 * derivation as the footer wordmark. It is the loudest single glyph on the site
 * after the hero, and it earns that: it is the one number the whole run
 * produced.
 *
 * Every number on this panel comes out of `finish`, which the server computed
 * from its own `picks` rows. The question list is still passed in, but only for
 * prompt and option text — the correct answers and their notes arrive with the
 * readout, because the client was never told them any earlier.
 *
 * There is no "run it again": one attempt per person is the rule, so the second
 * action here is the board rather than a restart.
 */
const VERDICTS: { min: number; line: string }[] = [
  { min: 1, line: 'Clean deploy. Nothing to roll back.' },
  { min: 0.9, line: 'Ships today. One hotfix pending.' },
  { min: 0.7, line: 'Builds green, tests amber.' },
  { min: 0.5, line: 'It compiles. Do not deploy on a Friday.' },
  { min: 0.3, line: 'Rolled back. The logs are worth reading.' },
  { min: 0, line: 'Redeployed from scratch. Everyone starts here.' }
];

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

const ResultPanel = forwardRef<
  HTMLDivElement,
  {
    questions: QuizQuestion[];
    /** The server's readout: score, time, rank and the full answer key for this run. */
    finish: FinishResponse;
    onLeaderboard: () => void;
    className?: string;
  }
>(({ questions, finish, onLeaderboard, className = '' }, ref) => {
  const { score, total, bestStreak, seconds, rank, review } = finish;
  const ratio = total ? score / total : 0;
  const verdict = VERDICTS.find(v => ratio >= v.min)?.line ?? VERDICTS[VERDICTS.length - 1].line;
  const accent = ratio >= 0.7 ? 'var(--color-signal-ok)' : ratio >= 0.4 ? 'var(--color-scan-pink)' : 'var(--color-signal-off)';

  // The log walks the question list for its copy and the review for its verdicts,
  // so a question the run never reached simply has no entry and reads as unanswered.
  const byId = useMemo(() => new Map(review.map(entry => [entry.qId, entry])), [review]);

  // The strike is a first-sight event, so it is armed one frame after mount
  // rather than baked into the initial render: a keyframed animation that is
  // already at 100% by the time the panel finishes warping in never plays.
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLit(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`}>
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
              style={{ color: accent }}
            >
              Readout
            </span>
            <span data-warp="eyebrow" className="font-mono text-[0.7rem] tracking-[0.3em] text-white/40 md:text-xs">
              {String(total).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
          </div>
          <div
            data-warp="rule"
            className="mt-3 h-px w-full"
            style={{ background: `linear-gradient(90deg, ${accent}, rgba(255,255,255,0.09))` }}
          />
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[clamp(1.25rem,3vh,2.25rem)] py-[clamp(1.25rem,3.5vh,2.5rem)] lg:flex-row lg:items-start lg:gap-16">
          <div className="shrink-0">
            <p className="flex items-baseline gap-3 font-extrabold leading-[0.82] tracking-[-0.04em]">
              {/* `--lit` has to land on the glyph itself. `.quiz-score` declares
                  its own fallback `--lit`, and a declaration on the element beats
                  an inherited value from the parent, so setting it one level up
                  left every score glowing the default pink. */}
              <span
                data-warp="title"
                style={{ ['--lit' as string]: accent }}
                className={`quiz-score text-[clamp(4.5rem,13vw,11rem)] ${lit ? 'quiz-score-lit' : ''}`}
              >
                {String(score).padStart(2, '0')}
              </span>
              <span className="font-mono text-[clamp(0.9rem,1.6vw,1.15rem)] font-medium tracking-[0.24em] text-white/40">
                / {String(total).padStart(2, '0')}
              </span>
            </p>
            <p
              data-warp="tagline"
              className="mt-4 max-w-[26ch] text-[clamp(1.05rem,1.7vw,1.5rem)] font-semibold leading-snug text-white"
            >
              {verdict}
            </p>
            <p data-warp="tagline" className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.32em] text-white/45">
              Rank {String(rank).padStart(2, '0')} · {formatSeconds(seconds)}
            </p>
            <div data-warp="cta" className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onLeaderboard}
                className="group inline-flex w-fit items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-space transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                style={{ backgroundColor: accent }}
              >
                See the leaderboard
                <span
                  aria-hidden="true"
                  className="transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover:translate-x-1"
                >
                  →
                </span>
              </button>
              <a
                href="/"
                className="rounded-full border border-white/20 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Back to the journey
              </a>
            </div>
          </div>

          {/* Review. Hairline rows, not cards: it is a log, and a log is a list
              of lines. Scrolls inside the frame so the masthead and the rail
              stay put no matter how long the run was. */}
          <div className="quiz-scroll min-h-0 flex-1 overflow-y-auto lg:max-h-full">
            <h3 className="font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/45">Answer log</h3>
            <ol className="mt-1">
              {questions.map(q => {
                const entry = byId.get(q.id);
                const given = entry ? entry.choice : -1;
                const key = entry ? entry.answer : -1;
                const ok = entry?.correct ?? false;
                return (
                  <li
                    key={q.id}
                    data-warp="meta"
                    className="grid grid-cols-[auto_1fr] gap-x-4 border-t border-white/[0.09] py-3.5 last:border-b"
                  >
                    <span
                      aria-hidden="true"
                      className="font-mono text-[0.7rem] leading-6"
                      style={{ color: ok ? 'var(--color-signal-ok)' : 'var(--color-signal-off)' }}
                    >
                      {ok ? '✓' : '✕'}
                    </span>
                    <div>
                      <p className="text-[0.9rem] font-semibold leading-snug text-white/90">{q.prompt}</p>
                      <p className="mt-1 font-mono text-[0.7rem] tracking-[0.06em] text-white/45">
                        {ok ? (
                          <>
                            {KEYS[key]} · {q.options[key]}
                          </>
                        ) : (
                          <>
                            You: {given >= 0 ? `${KEYS[given]} · ${q.options[given]}` : 'no answer'}
                            {key >= 0 ? (
                              <>
                                {' '}
                                → {KEYS[key]} · {q.options[key]}
                              </>
                            ) : null}
                          </>
                        )}
                      </p>
                      {entry && (
                        <p className="mt-1.5 max-w-[72ch] text-[0.8125rem] leading-[1.55] text-white/55">
                          {entry.note}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <footer className="shrink-0">
          <div className="h-px w-full" style={{ background: `linear-gradient(90deg, ${accent}66, rgba(255,255,255,0.08) 38%, transparent)` }} />
          <dl className="mt-4 grid grid-cols-3 gap-x-6 md:mt-5 md:gap-x-10">
            {[
              { label: 'Accuracy', value: `${Math.round(ratio * 100)}%` },
              { label: 'Best streak', value: String(bestStreak).padStart(2, '0') },
              { label: 'Total time', value: formatSeconds(seconds) }
            ].map(row => (
              <div key={row.label} data-warp="meta">
                <dt className="font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/55 md:text-[0.6875rem]">
                  {row.label}
                </dt>
                <dd className="mt-1.5 font-mono text-[0.9375rem] text-white/90 md:text-base">{row.value}</dd>
              </div>
            ))}
          </dl>
        </footer>
      </div>
    </div>
  );
});

ResultPanel.displayName = 'ResultPanel';
export default ResultPanel;
