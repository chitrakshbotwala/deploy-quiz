import { formatSeconds } from '@/lib/quizApi';
import type { EventState, SectionState, StageState } from '@/lib/quizApi';

/**
 * The ladder: where you are, what is open, and what you scored.
 *
 * This is the screen between sign-in and a section, and the only navigation the
 * quiz has. It draws itself entirely from the server's state — a section is
 * startable because the server said `open`, never because the client worked out
 * that it should be. Anything else would mean two implementations of the flow,
 * and the one in the browser would be the wrong one.
 *
 * Note what a participant is shown about other people: nothing. No rank while a
 * stage is live, no total entered, no board. The only rank that ever appears is
 * their own, on the eliminated screen, after a cut is frozen — because at that
 * point it is the explanation for a door being shut.
 */
const ACCENT = '#ff9ffc';

const STATUS_COPY: Record<SectionState['status'], { badge: string; hint: string }> = {
  open: { badge: 'Open', hint: 'Not started.' },
  'in-progress': { badge: 'Resume', hint: 'Started. Your place is held.' },
  done: { badge: 'Done', hint: 'Recorded.' },
  locked: { badge: 'Locked', hint: 'Finish the section before it first.' },
  barred: { badge: '—', hint: 'Not open to you.' }
};

function StageCard({
  stage,
  onStart,
  busySection,
  live
}: {
  stage: StageState;
  onStart: (sectionId: string) => void;
  busySection: string | null;
  /** False before the organisers start the quiz, and after they stop it. */
  live: boolean;
}) {
  // The stage's own state, which is a different thing from whether the event is
  // running: a stage can be the one you are on while the quiz has not started.
  const stageLive = stage.status === 'open' || stage.status === 'advanced';
  return (
    <li className="border-t border-white/[0.09] py-6 last:border-b">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em] text-white md:text-[1.2rem]">
          {stage.label}
        </h3>
        <span
          className="font-mono text-[0.625rem] uppercase tracking-[0.3em]"
          style={{ color: stageLive && live ? ACCENT : 'rgba(255,255,255,0.6)' }}
        >
          {stage.status === 'awaiting-cut'
            ? `Awaiting the top ${stage.cutoff}`
            : stage.status === 'advanced'
              ? 'Through'
              : stage.status === 'eliminated'
                ? 'Closed'
                : stage.status === 'locked'
                  ? 'Not open yet'
                  : `Top ${stage.cutoff} advance`}
        </span>
      </div>

      {/* The stage total, once anything in it is finished. It is the number the
          cut is taken on, so it is stated rather than left to be added up. */}
      {stage.sections.some(s => s.status === 'done') && (
        <p className="mt-1.5 font-mono text-[0.7rem] tracking-[0.06em] text-white/60">
          {stage.score} / {stage.total} · {formatSeconds(stage.seconds)} answering time
        </p>
      )}

      <ol className="mt-4">
        {stage.sections.map(section => {
          const copy = STATUS_COPY[section.status];
          // Reachable AND the quiz is running. The server checks both too — this
          // is the drawing of the rule, not the rule.
          const reachable = section.status === 'open' || section.status === 'in-progress';
          const actionable = reachable && live;
          const busy = busySection === section.id;
          return (
            <li
              key={section.id}
              className="grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-2 border-t border-white/[0.06] py-3.5 first:border-t-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[0.9rem] font-semibold text-white/90">{section.label}</p>
                <p className="mt-1 font-mono text-[0.6875rem] tracking-[0.04em] text-white/60">
                  {section.result
                    ? `${section.result.score} / ${section.result.total} · ${formatSeconds(section.result.seconds)}`
                    : `${section.questionCount} questions · ${section.secondsPerQuestion}s each · ${copy.hint}`}
                </p>
              </div>
              {actionable ? (
                <button
                  type="button"
                  onClick={() => onStart(section.id)}
                  disabled={busy}
                  className="rounded-full px-5 py-2 text-[0.8125rem] font-semibold text-space transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] enabled:hover:scale-105 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  {busy ? 'Opening…' : section.status === 'in-progress' ? 'Resume' : 'Start'}
                </button>
              ) : (
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/55">
                  {reachable ? 'Waiting' : copy.badge}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {stage.status === 'awaiting-cut' && (
        <p className="mt-4 max-w-[62ch] text-[0.8125rem] leading-[1.6] text-white/70">
          Every section in this round is in. The organisers take the top {stage.cutoff} by score, and
          by answering time where scores tie. Nothing more to do here until they do.
        </p>
      )}
      {stage.status === 'locked' && (
        <p className="mt-4 max-w-[62ch] text-[0.8125rem] leading-[1.6] text-white/70">
          Opens for the participants who come through the round before it.
        </p>
      )}
      {stage.finalist && (
        <p className="mt-4 max-w-[62ch] text-[0.8125rem] leading-[1.6]" style={{ color: 'var(--color-signal-ok)' }}>
          You are one of the {stage.cutoff} finalists. The organisers will take it from here.
        </p>
      )}
    </li>
  );
}

export default function StageLadder({
  name,
  stages,
  event,
  onStart,
  onSignOut,
  busySection,
  error
}: {
  name: string;
  stages: StageState[];
  event: EventState;
  onStart: (sectionId: string) => void;
  onSignOut: () => void;
  busySection: string | null;
  error: string | null;
}) {
  const done = stages.flatMap(s => s.sections).filter(s => s.status === 'done').length;
  const all = stages.flatMap(s => s.sections).length;
  const live = event.status === 'running';

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
              Your rounds
            </span>
            <span data-warp="eyebrow" className="truncate font-mono text-[0.7rem] tracking-[0.3em] text-white/60 md:text-xs">
              {name}
            </span>
          </div>
          <div
            data-warp="rule"
            className="mt-3 h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}, rgba(255,255,255,0.09))` }}
          />
        </header>

        {/* `flex-1` without a zero min-height on purpose. The column above scrolls,
            and a flex item that is allowed to shrink past its content never makes
            it overflow — the ladder would silently squash to the frame instead,
            spilling its last stages straight over the footer. That is what a
            browser zoomed past 100% is: a short viewport with tall content. The
            content-based minimum keeps the item at its own height, so the
            overflow lands on the scroller that is there to take it. */}
        <div className="flex-1 py-[clamp(1.25rem,3.5vh,2.5rem)]">
          <div className="max-w-[52rem]">
            {error && (
              <p className="mb-5 max-w-[62ch] text-[0.8125rem] leading-[1.5]" style={{ color: 'var(--color-signal-off)' }}>
                {error}
              </p>
            )}

            {/* The waiting line. It is a banner rather than a note on each section
                because it is the answer to the only question someone who just
                registered has, and it has to be readable from the back of a room.
                The page polls while it is up, so nobody has to be told to refresh. */}
            {!live && (
              <div
                className="mb-6 rounded-2xl border p-5"
                style={{
                  borderColor: event.status === 'stopped' ? 'rgba(219,128,121,0.35)' : `${ACCENT}38`,
                  background: 'rgba(255,255,255,0.02)'
                }}
              >
                <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-[0.32em] text-white/60">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2 w-2 rounded-full ${event.status === 'stopped' ? '' : 'animate-pulse'}`}
                    style={{
                      backgroundColor: event.status === 'stopped' ? 'var(--color-signal-off)' : ACCENT
                    }}
                  />
                  {event.status === 'stopped' ? 'Quiz ended' : 'Not started'}
                </p>
                <p
                  aria-live="polite"
                  className="mt-2.5 max-w-[34ch] text-[clamp(1.05rem,2vw,1.45rem)] font-semibold leading-snug text-white"
                >
                  {event.status === 'stopped'
                    ? 'The organisers have ended the quiz.'
                    : 'Waiting for the organisers to start the quiz.'}
                </p>
                <p className="mt-2 max-w-[58ch] text-[0.8125rem] leading-[1.6] text-white/70">
                  {event.status === 'stopped'
                    ? 'Nothing more to answer. Your recorded sections are below.'
                    : 'You are registered — that part is done. Keep this page open; it opens by itself the moment they start, with no refresh needed.'}
                </p>
              </div>
            )}
            <ol>
              {stages.map(stage => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  onStart={onStart}
                  busySection={busySection}
                  live={live}
                />
              ))}
            </ol>
            <p className="mt-6 max-w-[62ch] text-[0.75rem] leading-[1.6] text-white/55">
              Each question is served for a fixed number of seconds and locks when the clock runs
              out, whether or not anything is selected. A refresh does not restart it. Correct
              answers are not shown while the rounds are open.
            </p>
          </div>
        </div>

        <footer className="shrink-0">
          <div
            className="h-px w-full"
            style={{ background: `linear-gradient(90deg, ${ACCENT}66, rgba(255,255,255,0.08) 38%, transparent)` }}
          />
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4 md:mt-5">
            <dl className="grid grid-cols-2 gap-x-8 md:gap-x-10">
              {[
                { label: 'Sections done', value: `${String(done).padStart(2, '0')} / ${String(all).padStart(2, '0')}` },
                {
                  label: 'Quiz',
                  value: event.status === 'running' ? 'Live' : event.status === 'stopped' ? 'Ended' : 'Not started'
                }
              ].map(row => (
                <div key={row.label} data-warp="meta">
                  <dt className="font-mono text-[0.625rem] uppercase tracking-[0.3em] text-white/55 md:text-[0.6875rem]">
                    {row.label}
                  </dt>
                  <dd className="mt-1.5 max-w-[22ch] truncate font-mono text-[0.9375rem] text-white/90 md:text-base">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-full border border-white/20 px-5 py-2 font-mono text-[0.8125rem] text-white/70 transition-colors hover:border-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Sign out
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
