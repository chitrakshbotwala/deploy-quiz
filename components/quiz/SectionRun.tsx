import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { gsap } from '@/lib/gsap';
import { useIsMobile, usePrefersReducedMotion } from '@/hooks/useMediaQuery';
import { useSection } from '@/hooks/useSection';
import type { FinishResponse, SectionRunResponse } from '@/lib/quizApi';
import AsteroidField from './AsteroidField';
import QuestionPanel from './QuestionPanel';
import ResultPanel from './ResultPanel';

const KEY_CODES = ['a', 'b', 'c', 'd', 'e', 'f'];
const ACCENT = '#ff9ffc';

/**
 * One open section, drawn a question at a time.
 *
 * Two renderers, one engine, one frame:
 *  - Desktop with motion allowed gets the WebGL asteroid field. Locking an answer
 *    flies the camera to the next rock in the next question's accent.
 *  - Everything else gets the warp panels: the same panel choreography the event
 *    chapters use on a phone, over the canvas starfield.
 *  - Reduced motion gets the panels with no warp at all, which is the end state of
 *    both: the question is simply there.
 *
 * ── Why the warp is short here ──────────────────────────────────────────────
 * The old ten-question run had a feedback beat to hide latency in: a pick landed,
 * a note appeared, and the visitor read it while the next question was fetched.
 * There is no such beat any more — a lock is immediately followed by the next
 * question, and the clock on that question starts when the SERVER says it does.
 * A long transition would therefore be burning someone's ten seconds on
 * animation, so the arrival is a fast fade-and-settle rather than the full warp.
 *
 * The asteroid field is memoised on its own props. The question panel re-renders
 * ten times a second to move the countdown, and passing a freshly built element
 * through would drag a WebGL scene's React wrapper through every one of those.
 */
export default function SectionRun({
  run,
  onDone
}: {
  run: SectionRunResponse;
  /** Called from the readout, with the stage state the finish reported. */
  onDone: (finish: FinishResponse) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const useField = !isMobile && !reduced;

  const section = useSection(run);
  const { phase, question, index, total, selected, finish, error, fatal } = section;

  const stageRef = useRef<HTMLDivElement>(null);

  const field = useMemo(() => {
    if (!useField) return null;
    return (
      <AsteroidField
        index={phase === 'result' ? total : index}
        total={total}
        accent={phase === 'result' ? ACCENT : (question?.accent ?? ACCENT)}
        // The field's outcome channel is fed 'none' for the life of the run, and
        // that is not an oversight: the browser is never told whether an answer
        // was right, so there is no correct-or-wrong flash to play.
        outcome="none"
      />
    );
  }, [index, phase, question?.accent, total, useField]);

  // ── Arrival ───────────────────────────────────────────────────────────────
  // Keyed on the live question and on entering the readout, and on nothing else:
  // the countdown re-renders this component ten times a second and must not
  // restart an animation while it does.
  const arrivalKey = phase === 'result' ? 'result' : (question?.id ?? 'none');
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (reduced) {
      gsap.set(stage, { clearProps: 'all' });
      return;
    }
    const ctx = gsap.context(() => {
      const q = (sel: string) => {
        const found = Array.from(stage.querySelectorAll(sel));
        return found.length ? found : null;
      };
      const tl = gsap.timeline();
      tl.fromTo(
        stage,
        { autoAlpha: 0, scale: isMobile ? 1.04 : 1.08, filter: isMobile ? 'blur(0px)' : 'blur(10px)' },
        { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.42, ease: 'power3.out' },
        0
      );
      const part = (sel: string, from: gsap.TweenVars, to: gsap.TweenVars, at: number) => {
        const targets = q(sel);
        if (targets) tl.fromTo(targets, from, to, at);
      };
      part('[data-warp="ghost"]', { autoAlpha: 0, scale: 1.3 }, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, 0.02);
      part('[data-warp="title"]', { yPercent: 110 }, { yPercent: 0, duration: 0.44, ease: 'power4.out' }, 0.04);
      part('[data-warp="tagline"]', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.26, ease: 'power3.out' }, 0.14);
      // The options print in row by row. Tight stagger: this is the beat the
      // question exists for, and the clock is already running.
      part(
        '[data-warp="option"]',
        { autoAlpha: 0, yPercent: 24 },
        { autoAlpha: 1, yPercent: 0, duration: 0.24, ease: 'power3.out', stagger: 0.04 },
        0.16
      );
      part('[data-warp="meta"]', { autoAlpha: 0, yPercent: 30 }, { autoAlpha: 1, yPercent: 0, duration: 0.24, ease: 'power3.out', stagger: 0.04 }, 0.2);
      part('[data-warp="cta"]', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power3.out' }, 0.26);
    }, stage);
    return () => ctx.revert();
  }, [arrivalKey, isMobile, reduced]);

  // Keyboard. A–F or 1–9 select a row; Enter locks. Enter is bound here rather
  // than left to the Continue button's own activation because the button is
  // disabled until something is selected, so it cannot hold focus for the whole
  // question.
  useEffect(() => {
    if (phase !== 'question' || !question) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') {
        if (selected !== null) {
          e.preventDefault();
          section.commit();
        }
        return;
      }
      const k = e.key.toLowerCase();
      const byLetter = KEY_CODES.indexOf(k);
      const byDigit = /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
      const pickIndex = byLetter >= 0 ? byLetter : byDigit;
      if (pickIndex < 0 || pickIndex >= question.options.length) return;
      e.preventDefault();
      section.select(pickIndex);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, question, section, selected]);

  return (
    <>
      {field}
      <main className="relative z-10 h-full">
        <div ref={stageRef} className="absolute inset-0 will-change-transform">
          {phase === 'result' && finish ? (
            <ResultPanel finish={finish} sectionLabel={run.section.label} onContinue={() => onDone(finish)} />
          ) : fatal ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
              <p className="max-w-[46ch] text-[0.95rem] leading-[1.6] text-white/70">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full border border-white/20 px-6 py-2.5 font-mono text-sm text-white/70 transition-colors hover:border-white/50 hover:text-white"
              >
                Reload
              </button>
            </div>
          ) : question ? (
            <QuestionPanel
              key={question.id}
              question={question}
              index={index}
              total={total}
              answered={section.answered}
              selected={selected}
              secondsLeft={section.secondsLeft}
              fraction={section.fraction}
              locking={phase === 'locking'}
              error={error}
              retrying={section.retrying}
              isLast={section.isLast}
              variant={useField ? 'field' : 'warp'}
              sectionLabel={run.section.label}
              onSelect={section.select}
              onCommit={section.commit}
            />
          ) : (
            // The gap between the last lock and the readout. Short, but a black
            // screen with no word on it reads as a crash.
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-white/55">
                {error ?? 'Compiling your score…'}
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
