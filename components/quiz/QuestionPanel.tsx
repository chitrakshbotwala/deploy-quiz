import { forwardRef } from 'react';
import type { PublicQuestion } from '@/lib/quizApi';

const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * One question, drawn in the main page's panel frame.
 *
 * The frame is not a lookalike — it is the same three fixed anchors
 * EventDetailsPanel uses, for the same reason: a masthead rule at the top, a
 * telemetry rail at the bottom, and the only height-variable content between
 * them. Ten questions of different lengths have to warp into each other without
 * the eyebrow and the rail moving, or the run reads as ten different pages
 * instead of one instrument changing readout.
 *
 * Two variants, one structure:
 *  - `field` (desktop) — the panel sits over a live WebGL asteroid field, so the
 *    body column is held to the left half and the rock is the depth mass on the
 *    right. No ghost numeral: the rock is already doing that job.
 *  - `warp` (mobile / no WebGL) — full-width body, and the ghost numeral and the
 *    drifting accent blobs come back, exactly as on the event panels.
 *
 * ── What this panel deliberately cannot draw ────────────────────────────────
 * There is no correct/incorrect state on an option row, and no explanation slot
 * under them. The server does not tell the browser whether a pick was right, so
 * there is nothing here to render even if a row wanted to. The only feedback a
 * participant gets is that their selection is held, and then that it was locked.
 *
 * ── The clock ───────────────────────────────────────────────────────────────
 * The countdown is the loudest thing on the panel after the prompt, because it is
 * the constraint the whole section is built around. It reads as a number and as a
 * depleting bar on the masthead rule, and it turns to the warning colour with
 * three seconds left. The number comes from the run state, which derives it from a
 * server deadline — this component never looks at the local clock.
 */
export interface QuestionPanelProps {
  question: PublicQuestion;
  index: number;
  total: number;
  /** Questions locked so far, from the server. Drives the progress rail. */
  answered: number;
  /** Held, not committed. Null until a row is clicked. */
  selected: number | null;
  secondsLeft: number;
  /** 0…1 of the per-question budget left. */
  fraction: number;
  /** True while the lock is in the air: rows go quiet, Continue goes busy. */
  locking: boolean;
  /** A lock could not be recorded. Shown where the Continue affordance sits. */
  error: string | null;
  /** A delivery is being retried. The rows stay locked and the panel says so. */
  retrying: boolean;
  isLast: boolean;
  variant: 'field' | 'warp';
  sectionLabel: string;
  onSelect: (option: number) => void;
  onCommit: () => void;
  className?: string;
}

const QuestionPanel = forwardRef<HTMLDivElement, QuestionPanelProps>(
  (
    {
      question,
      index,
      total,
      answered,
      selected,
      secondsLeft,
      fraction,
      locking,
      error,
      retrying,
      isLast,
      variant,
      sectionLabel,
      onSelect,
      onCommit,
      className = ''
    },
    ref
  ) => {
    const num = String(index + 1).padStart(2, '0');
    const accent = question.accent;
    // Three seconds is where a countdown stops being information and becomes
    // pressure, so that is where it changes colour.
    const urgent = secondsLeft <= 3;
    const clockColour = urgent ? 'var(--color-signal-off)' : accent;

    return (
      <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`}>
        {variant === 'warp' && (
          <>
            {/* Same drifting accent field as the event panels, under the same
                frosted layer. Desktop-only backdrop-blur, for the same mobile
                GPU reason it is desktop-only there. */}
            <div data-warp="blobs" className="pointer-events-none absolute inset-0">
              <div
                className="blob-a absolute left-[-6%] top-[-8%] h-[46vw] w-[46vw] rounded-full blur-xl"
                style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)`, opacity: 0.42 }}
              />
              <div
                className="blob-c absolute bottom-[-12%] right-[-4%] h-[42vw] w-[42vw] rounded-full blur-xl"
                style={{ background: `radial-gradient(circle, ${accent}, transparent 72%)`, opacity: 0.3 }}
              />
            </div>
            <span
              aria-hidden="true"
              data-warp="ghost"
              className="pointer-events-none absolute right-[-8%] top-[clamp(6rem,15vh,8.5rem)] select-none font-extrabold leading-none text-white/[0.05] text-[58vw] md:bottom-[7%] md:top-auto md:text-white/[0.035] md:text-[min(40vw,50vh)]"
            >
              {num}
            </span>
          </>
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(135% 105% at 50% 45%, transparent 52%, #00000059)' }}
        />

        <div className="quiz-scroll relative z-10 flex h-full flex-col overflow-y-auto px-[clamp(1.5rem,6vw,7rem)] pb-[clamp(1.75rem,6vh,4rem)] pt-[clamp(5.5rem,13vh,8.5rem)]">
          {/* ── Masthead: anchor one ─────────────────────────────────────── */}
          <header className="shrink-0">
            <div className="flex items-baseline justify-between gap-6">
              <span
                data-warp="eyebrow"
                className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.42em] md:text-xs"
                style={{ color: accent }}
              >
                {sectionLabel}
              </span>
              <span
                data-warp="eyebrow"
                className="font-mono text-[0.7rem] tracking-[0.3em] text-white/40 md:text-xs"
              >
                {num} / {String(total).padStart(2, '0')}
              </span>
            </div>
            {/* The rule doubles as the clock. It empties left to right over the
                ten seconds, so the constraint is drawn on the same line that
                says which question this is. */}
            <div className="relative mt-3 h-px w-full" style={{ background: 'rgba(255,255,255,0.09)' }}>
              <div
                data-warp="rule"
                className="absolute inset-y-0 left-0 origin-left"
                style={{
                  width: '100%',
                  transform: `scaleX(${Math.max(0, Math.min(1, fraction))})`,
                  background: `linear-gradient(90deg, ${clockColour}, ${clockColour}44)`,
                  // No transition: the value already updates ten times a second,
                  // and easing it would make the bar lag the number beside it.
                  transition: 'none'
                }}
              />
            </div>
          </header>

          {/* ── Body: the only part allowed to change height ──────────────── */}
          <div className="flex flex-1 items-center py-[clamp(1.25rem,3.5vh,2.5rem)]">
            <div className={variant === 'field' ? 'w-full max-w-[min(46rem,50vw)]' : 'w-full md:max-w-[46rem]'}>
              {/* Masked prompt: the h2 is the clip window, the span travels. */}
              <h2 className="overflow-hidden pb-[0.34em] -mb-[0.2em] text-[clamp(1.6rem,3.4vw,3.1rem)] font-extrabold leading-[0.98] tracking-[-0.025em] text-white">
                <span data-warp="title" id={`prompt-${question.id}`} className="block text-balance">
                  {question.prompt}
                </span>
              </h2>
              <div data-warp="tagline" className="mt-2.5 flex items-baseline gap-4">
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.32em]" style={{ color: accent }}>
                  {question.topic}
                </p>
                {/* aria-live on the seconds would have a screen reader announce a
                    new number ten times a second. The countdown is announced
                    once, at three seconds, by the warning below. */}
                <p
                  aria-hidden="true"
                  className="font-mono text-[0.7rem] tabular-nums uppercase tracking-[0.32em]"
                  style={{ color: clockColour }}
                >
                  {String(Math.max(0, secondsLeft)).padStart(2, '0')}s
                </p>
              </div>

              <div role="group" aria-labelledby={`prompt-${question.id}`} className="mt-[clamp(1.25rem,3vh,2rem)]">
                {question.options.map((option, i) => (
                  <button
                    key={option}
                    type="button"
                    data-warp="option"
                    /* One state, and it is not a verdict: `picked` means held.
                       The stylesheet's correct/wrong rules are unreachable from
                       this panel, which is the point. */
                    data-state={selected === i ? 'picked' : undefined}
                    aria-pressed={selected === i}
                    disabled={locking}
                    onClick={() => onSelect(i)}
                    style={{ ['--lit' as string]: accent }}
                    className={`quiz-answer group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white disabled:cursor-default ${
                      locking && selected !== i ? 'opacity-45' : ''
                    }`}
                  >
                    <span className="quiz-key" aria-hidden="true">
                      {KEYS[i]}
                    </span>
                    <span className="quiz-label text-[0.95rem] leading-snug md:text-lg">{option}</span>
                    {selected === i && (
                      <span className="quiz-mark" aria-hidden="true">
                        ●
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/35">
                {retrying
                  ? 'Reconnecting…'
                  : locking
                    ? 'Locking…'
                    : `Keys ${KEYS.slice(0, question.options.length).join(' ')} · Enter to lock`}
              </p>

              {/* ── Commit ─────────────────────────────────────────────────
                  Height is reserved whether or not the button is armed. Without
                  the reservation the option rows jump the instant a selection
                  lands, at the exact moment the participant is deciding. */}
              <div className="mt-[clamp(1rem,2.5vh,1.75rem)] min-h-[6rem]">
                <button
                  type="button"
                  onClick={onCommit}
                  disabled={selected === null || locking}
                  className="group inline-flex w-fit items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-space transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] enabled:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  style={{ backgroundColor: accent }}
                >
                  {isLast ? 'Lock in and finish' : 'Lock in and continue'}
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] group-enabled:group-hover:translate-x-1"
                  >
                    →
                  </span>
                </button>
                <div className="mt-3 min-h-[2.5rem]" aria-live="polite">
                  {error ? (
                    <p className="max-w-[62ch] text-[0.8125rem] leading-[1.5]" style={{ color: 'var(--color-signal-off)' }}>
                      {error}
                    </p>
                  ) : (
                    <p className="max-w-[62ch] text-[0.75rem] leading-[1.6] text-white/40">
                      {selected === null
                        ? 'Pick an option. It is not locked until you continue — or until the clock runs out.'
                        : 'Held. Change it or lock it in; the clock does not stop either way.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Telemetry rail: anchor two ───────────────────────────────── */}
          <footer className="shrink-0">
            <div className="relative h-px w-full bg-white/[0.08]">
              <div
                className="quiz-progress absolute inset-0 h-px origin-left"
                style={{
                  transform: `scaleX(${total ? answered / total : 0})`,
                  background: `linear-gradient(90deg, ${accent}, ${accent}66)`
                }}
              />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-x-6 md:mt-5 md:gap-x-10">
              {[
                { label: 'Locked', value: `${String(answered).padStart(2, '0')} / ${String(total).padStart(2, '0')}` },
                { label: 'Selection', value: selected === null ? '—' : KEYS[selected] },
                {
                  label: 'Time left',
                  value: (
                    <span style={{ color: urgent ? 'var(--color-signal-off)' : undefined }}>
                      {String(Math.max(0, secondsLeft)).padStart(2, '0')}s
                    </span>
                  )
                }
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
);

QuestionPanel.displayName = 'QuestionPanel';
export default QuestionPanel;
