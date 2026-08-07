import { useEffect, useState } from 'react';
import { formatSeconds } from '@/lib/quizApi';
import type { StageState } from '@/lib/quizApi';

/**
 * The end of the road, for everyone below the cut.
 *
 * It is a full screen rather than a line on the ladder, because it is the answer
 * to the only question the participant has at that moment, and burying it under a
 * list of locked sections would read as a bug. The rank is stated plainly — it is
 * the reason the next round is shut, and a number is less insulting than a
 * euphemism.
 *
 * This is also the ONLY place a participant is ever told a rank. It appears after
 * the cut is frozen, so it is a fact with a timestamp rather than a live position
 * that could change under them ten minutes later.
 */
const ACCENT = 'var(--color-signal-off)';

export default function EliminatedPanel({
  stage,
  nextStageLabel,
  onBack
}: {
  stage: StageState;
  nextStageLabel: string;
  onBack: () => void;
}) {
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLit(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rank = stage.rank ?? 0;
  const of = stage.rankedOf;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(135% 105% at 50% 45%, transparent 52%, #00000059)' }}
      />
      <div className="quiz-scroll relative z-10 flex h-full flex-col overflow-y-auto px-[clamp(1.5rem,6vw,7rem)] pb-[clamp(1.75rem,6vh,4rem)] pt-[var(--quiz-pad-top)]">
        <header className="shrink-0">
          <div className="flex items-baseline justify-between gap-6">
            <span
              data-warp="eyebrow"
              className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.42em] md:text-xs"
              style={{ color: ACCENT }}
            >
              {stage.label} · result
            </span>
            <span data-warp="eyebrow" className="font-mono text-[0.7rem] tracking-[0.3em] text-white/60 md:text-xs">
              Final
            </span>
          </div>
          <div
            data-warp="rule"
            className="mt-3 h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}, rgba(255,255,255,0.09))` }}
          />
        </header>

        {/* Centred while it fits, scrolled once it does not — which needs the
            content-based minimum a `min-h-0` would remove. Shrinkable, this
            would squash to the frame at a zoomed-in viewport and lay itself over
            the footer rather than overflowing the scroller above it. */}
        <div className="flex flex-1 flex-col justify-center py-[clamp(1.25rem,3.5vh,2.5rem)]">
          <div className="max-w-[46rem]">
            <p className="flex items-baseline gap-3 font-extrabold leading-[0.82] tracking-[-0.04em]">
              <span aria-hidden="true" className="font-mono text-[clamp(0.9rem,1.6vw,1.15rem)] font-medium tracking-[0.24em] text-white/55">
                #
              </span>
              <span
                data-warp="title"
                style={{ ['--lit' as string]: ACCENT }}
                className={`quiz-score text-[clamp(4rem,11vw,9rem)] ${lit ? 'quiz-score-lit' : ''}`}
              >
                {rank}
              </span>
              {of ? (
                <span className="font-mono text-[clamp(0.9rem,1.6vw,1.15rem)] font-medium tracking-[0.24em] text-white/60">
                  of {of}
                </span>
              ) : null}
            </p>

            <h2
              data-warp="tagline"
              className="mt-5 max-w-[30ch] text-[clamp(1.15rem,2vw,1.7rem)] font-semibold leading-snug text-white"
            >
              Sorry — your rank was {rank}, and you are not eligible for {nextStageLabel}.
            </h2>
            <p data-warp="tagline" className="mt-3 max-w-[58ch] text-[0.9rem] leading-[1.6] text-white/70">
              {stage.label} took the top {stage.cutoff}
              {of ? ` of ${of} who finished it` : ''}. You finished on {stage.score} of {stage.total} in{' '}
              {formatSeconds(stage.seconds)} of answering time — where scores tied, the faster time went
              through.
            </p>
            <p data-warp="meta" className="mt-4 max-w-[58ch] text-[0.8125rem] leading-[1.6] text-white/60">
              Nothing else to do here, and nothing to reload — this is the frozen result, not a live
              position. Thanks for flying it.
            </p>

            <div data-warp="cta" className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                className="rounded-full border border-white/20 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                See your sections
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
              { label: 'Your rank', value: `#${rank}` },
              { label: 'Score', value: `${stage.score} / ${stage.total}` },
              { label: 'Answering time', value: formatSeconds(stage.seconds) }
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
}
