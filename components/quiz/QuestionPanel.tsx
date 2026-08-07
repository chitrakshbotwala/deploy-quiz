import { forwardRef } from 'react';
import type { QuizQuestion } from '@/content/quizQuestions';
import RunClock from './RunClock';

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
 * `data-warp` hooks mark everything the warp choreography drives, read off the
 * DOM by the parent rather than threaded through as refs — same contract as
 * EventDetailsPanel.
 */
export interface QuestionPanelProps {
  question: QuizQuestion;
  index: number;
  total: number;
  answered: boolean;
  picked: number | null;
  score: number;
  streak: number;
  startedAt: number;
  variant: 'field' | 'warp';
  isLast: boolean;
  onPick: (option: number) => void;
  onNext: () => void;
  className?: string;
}

/** Per-row state, which is what the CSS strikes / starves / reveals / mutes. */
function rowState(
  optionIndex: number,
  answer: number,
  picked: number | null,
  answered: boolean
): 'correct' | 'wrong' | 'reveal' | 'muted' | undefined {
  if (!answered) return undefined;
  if (optionIndex === picked) return picked === answer ? 'correct' : 'wrong';
  if (optionIndex === answer) return 'reveal';
  return 'muted';
}

const QuestionPanel = forwardRef<HTMLDivElement, QuestionPanelProps>(
  (
    {
      question,
      index,
      total,
      answered,
      picked,
      score,
      streak,
      startedAt,
      variant,
      isLast,
      onPick,
      onNext,
      className = ''
    },
    ref
  ) => {
    const num = String(index + 1).padStart(2, '0');
    const correct = answered && picked === question.answer;
    const accent = question.accent;

    return (
      <div
        ref={ref}
        className={`absolute inset-0 overflow-hidden ${className}`}
      >
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
              /* Two anchors, one element, exactly as on the event panels: on a
                 phone the numeral is tucked under the masthead rule at 58vw; on
                 a wide screen 58vw is a 900px digit sitting in the middle of the
                 page, so it drops to the bottom-right bleed and is capped
                 against viewport height. This variant renders at desktop widths
                 whenever motion is reduced, so the desktop case is real. */
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
                Question {num}
              </span>
              <span data-warp="eyebrow" className="font-mono text-[0.7rem] tracking-[0.3em] text-white/40 md:text-xs">
                {num} / {String(total).padStart(2, '0')}
              </span>
            </div>
            <div
              data-warp="rule"
              className="mt-3 h-px w-full"
              style={{ background: `linear-gradient(90deg, ${accent}, ${accent}33 42%, rgba(255,255,255,0.09))` }}
            />
          </header>

          {/* ── Body: the only part allowed to change height ──────────────── */}
          <div className="flex flex-1 items-center py-[clamp(1.25rem,3.5vh,2.5rem)]">
            {/* The warp variant is not phone-only — reduced motion routes a
                1440px desktop through it too, and a four-word answer stretched
                across 1268px is not a row anyone reads. Capped at the same
                measure the field variant uses. */}
            <div className={variant === 'field' ? 'w-full max-w-[min(46rem,50vw)]' : 'w-full md:max-w-[46rem]'}>
              {/* Masked prompt: the h2 is the clip window, the span travels. */}
              <h2 className="overflow-hidden pb-[0.34em] -mb-[0.2em] text-[clamp(1.6rem,3.4vw,3.1rem)] font-extrabold leading-[0.98] tracking-[-0.025em] text-white">
                <span data-warp="title" id={`prompt-${question.id}`} className="block text-balance">
                  {question.prompt}
                </span>
              </h2>
              <p
                data-warp="tagline"
                className="mt-2.5 font-mono text-[0.7rem] uppercase tracking-[0.32em]"
                style={{ color: accent }}
              >
                {question.topic}
              </p>

              <div
                role="group"
                aria-labelledby={`prompt-${question.id}`}
                className="mt-[clamp(1.25rem,3vh,2rem)]"
              >
                {question.options.map((option, i) => (
                  <button
                    key={option}
                    type="button"
                    data-warp="option"
                    data-state={rowState(i, question.answer, picked, answered)}
                    disabled={answered}
                    onClick={() => onPick(i)}
                    /* Only while the row is armed. Once a pick lands, the
                       state rules in the stylesheet own `--lit` (signal green or
                       signal red), and an inline custom property would outrank
                       them and leave a "correct" row glowing in the question's
                       own accent. */
                    style={answered ? undefined : { ['--lit' as string]: accent }}
                    className="quiz-answer group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white disabled:cursor-default"
                  >
                    <span className="quiz-key" aria-hidden="true">
                      {KEYS[i]}
                    </span>
                    <span className="quiz-label text-[0.95rem] leading-snug md:text-lg">{option}</span>
                    {answered && (i === picked || i === question.answer) ? (
                      <span className="quiz-mark" aria-hidden="true">
                        {i === question.answer ? '✓' : '✕'}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              {/* Keyboard is the primary input for the audience this is written
                  for, so it is stated rather than left to be discovered. Hidden
                  once a pick lands: at that point the only live control is the
                  Next button, which already holds focus. */}
              {!answered && (
                <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/35">
                  Keys {KEYS.slice(0, question.options.length).join(' ')}
                </p>
              )}

              {/* ── Outcome ────────────────────────────────────────────────
                  Height is reserved whether or not it is filled. Without the
                  reservation the option rows jump upward the instant a pick
                  lands, which lands as a layout fault at the exact moment the
                  visitor is reading the result of their own click. */}
              <div className="mt-[clamp(1rem,2.5vh,1.75rem)] min-h-[7.5rem] md:min-h-[6.5rem]">
                <div aria-live="polite" className={answered ? 'opacity-100' : 'opacity-0'}>
                  {answered && (
                    <>
                      <p
                        className="font-mono text-[0.7rem] uppercase tracking-[0.32em]"
                        style={{ color: correct ? 'var(--color-signal-ok)' : 'var(--color-signal-off)' }}
                      >
                        {correct ? 'Correct' : `Not quite. ${KEYS[question.answer]} is the answer.`}
                      </p>
                      <p className="mt-2 max-w-[68ch] text-[0.875rem] leading-[1.6] text-white/65 md:text-[0.95rem]">
                        {question.note}
                      </p>
                    </>
                  )}
                </div>
                {answered && (
                  <button
                    type="button"
                    onClick={onNext}
                    autoFocus
                    className="group mt-4 inline-flex w-fit items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-space transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    style={{ backgroundColor: accent }}
                  >
                    {isLast ? 'See your readout' : 'Next question'}
                    <span
                      aria-hidden="true"
                      className="transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] group-hover:translate-x-1"
                    >
                      →
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Telemetry rail: anchor two ─────────────────────────────────
              The progress hairline is the rail's own top edge, filled to the
              run's position. It is the only progress indicator on the page that
              does not need a number, which is why it can sit under one. */}
          <footer className="shrink-0">
            <div className="relative h-px w-full bg-white/[0.08]">
              <div
                className="quiz-progress absolute inset-0 h-px origin-left"
                style={{
                  transform: `scaleX(${(index + (answered ? 1 : 0)) / total})`,
                  background: `linear-gradient(90deg, ${accent}, ${accent}66)`
                }}
              />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-x-6 md:mt-5 md:gap-x-10">
              {[
                { label: 'Correct', value: `${String(score).padStart(2, '0')} / ${String(total).padStart(2, '0')}` },
                { label: 'Streak', value: String(streak).padStart(2, '0') },
                { label: 'Elapsed', value: <RunClock startedAt={startedAt} stoppedAt={null} /> }
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
  }
);

QuestionPanel.displayName = 'QuestionPanel';
export default QuestionPanel;
