import { forwardRef, useEffect, useState } from 'react';
import { formatSeconds } from '@/lib/quizApi';
import type { FinishResponse } from '@/lib/quizApi';

/**
 * End of a section. Same frame as the question panels, with the score standing in
 * for the display headline.
 *
 * The score is a neon tube, struck once on arrival, using the same `--on`
 * derivation as the footer wordmark. It earns being the loudest glyph on the
 * page: it is the one number the section produced, and — deliberately — the only
 * one. There is no answer log here and there never will be. A participant learns
 * their total and their time; which questions they missed is the organisers'
 * information until the event is over, because the same questions are still in
 * front of the people behind them in the queue.
 *
 * `seconds` is not wall clock. It is the sum of the time spent on the questions
 * themselves, which is what the ranking's tie-break uses, so the number shown here
 * is the number that decides a tie.
 */
const ACCENT = '#ff9ffc';

const ResultPanel = forwardRef<
  HTMLDivElement,
  {
    finish: FinishResponse;
    sectionLabel: string;
    onContinue: () => void;
    className?: string;
  }
>(({ finish, sectionLabel, onContinue, className = '' }, ref) => {
  const { score, total, seconds, stage } = finish;
  const ratio = total ? score / total : 0;

  // The strike is a first-sight event, so it is armed one frame after mount
  // rather than baked into the initial render: a keyframed animation that is
  // already at 100% by the time the panel finishes warping in never plays.
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLit(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // What happens next is a property of the stage, not of this score. Every branch
  // here is a state the server reported — none of it is inferred from the score,
  // because a participant is not told where the cut will fall.
  const nextSection = stage.sections.find(s => s.status === 'open');
  const headline = nextSection
    ? 'Section locked in.'
    : stage.status === 'awaiting-cut'
      ? 'Stage complete.'
      : stage.status === 'advanced'
        ? 'You are through.'
        : 'Recorded.';
  const detail = nextSection
    ? `${nextSection.label} is open when you are. Same clock: ${nextSection.secondsPerQuestion} seconds a question.`
    : stage.status === 'awaiting-cut'
      ? `Every answer is in. The organisers take the top ${stage.cutoff} once the round closes — watch this page, or the announcement.`
      : stage.status === 'advanced'
        ? 'The next round is open on the previous screen.'
        : 'Your attempt is saved.';

  return (
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`}>
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
              {sectionLabel}
            </span>
            <span data-warp="eyebrow" className="font-mono text-[0.7rem] tracking-[0.3em] text-white/40 md:text-xs">
              Recorded
            </span>
          </div>
          <div
            data-warp="rule"
            className="mt-3 h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}, rgba(255,255,255,0.09))` }}
          />
        </header>

        <div className="flex min-h-0 flex-1 flex-col justify-center py-[clamp(1.25rem,3.5vh,2.5rem)]">
          <div className="max-w-[46rem]">
            <p className="flex items-baseline gap-3 font-extrabold leading-[0.82] tracking-[-0.04em]">
              {/* `--lit` has to land on the glyph itself: `.quiz-score` declares its
                  own fallback, and a declaration on the element beats an inherited
                  value from a parent. */}
              <span
                data-warp="title"
                style={{ ['--lit' as string]: ACCENT }}
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
              {headline}
            </p>
            <p data-warp="tagline" className="mt-3 max-w-[54ch] text-[0.9rem] leading-[1.6] text-white/55">
              {detail}
            </p>
            {/* Said plainly rather than left to be noticed. Someone who expects a
                review screen should be told there is not one, and why. */}
            <p data-warp="meta" className="mt-4 max-w-[54ch] text-[0.75rem] leading-[1.6] text-white/35">
              Answers are not shown while the rounds are open. Ties are broken by total
              answering time, so the seconds below count.
            </p>

            <div data-warp="cta" className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onContinue}
                autoFocus
                className="group inline-flex w-fit items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-space transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                style={{ backgroundColor: ACCENT }}
              >
                {nextSection ? `Go to ${nextSection.label}` : 'Back to your rounds'}
                <span
                  aria-hidden="true"
                  className="transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover:translate-x-1"
                >
                  →
                </span>
              </button>
            </div>
          </div>
        </div>

        <footer className="shrink-0">
          <div
            className="h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}66, rgba(255,255,255,0.08) 38%, transparent)` }}
          />
          <dl className="mt-4 grid grid-cols-3 gap-x-6 md:mt-5 md:gap-x-10">
            {[
              { label: 'Score', value: `${String(score).padStart(2, '0')} / ${String(total).padStart(2, '0')}` },
              { label: 'Answering time', value: formatSeconds(seconds) },
              { label: `${stage.label} total`, value: `${stage.score} / ${stage.total}` }
            ].map(row => (
              <div key={row.label} data-warp="meta">
                <dt className="font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/55 md:text-[0.6875rem]">
                  {row.label}
                </dt>
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
});

ResultPanel.displayName = 'ResultPanel';
export default ResultPanel;
