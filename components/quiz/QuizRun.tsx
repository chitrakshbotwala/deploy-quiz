import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from '@/lib/gsap';
import { usePrefersReducedMotion, useIsMobile } from '@/hooks/useMediaQuery';
import { useQuiz } from '@/hooks/useQuiz';
import { quizQuestions } from '@/content/quizQuestions';
import type { StartResponse } from '@/lib/quizApi';
import AsteroidField from './AsteroidField';
import QuestionPanel from './QuestionPanel';
import ResultPanel from './ResultPanel';
import Leaderboard from './Leaderboard';

const KEY_CODES = ['a', 'b', 'c', 'd', 'e', 'f'];

/**
 * An open run, drawn a question at a time.
 *
 * Two renderers, one engine, one frame:
 *  - Desktop with motion allowed gets the WebGL asteroid field. Answering flies
 *    the camera to the next rock, through warp streaks, in the question's accent.
 *  - Everything else gets the warp panels: the identical panel choreography the
 *    event chapters use on a phone, over the same canvas starfield.
 *  - Reduced motion gets the panels with no warp at all, which is the end state
 *    of both: the question is simply there.
 *
 * The transition is sequenced by hand rather than left to a CSS class swap,
 * because the state change has to land INSIDE the warp: the outgoing panel
 * accelerates away, the accent flash peaks, the question changes under the
 * flash, and the new panel drops out of the warp behind it. Changing state first
 * and animating after would show the next question for a frame before it flew in.
 *
 * The server round-trip does NOT sit inside that warp. A pick is posted the
 * moment it is clicked and resolves during the feedback phase, while the visitor
 * is reading the note; by the time Next is pressed there is nothing left to wait
 * on. The one place latency could show is the readout, and `useQuiz` fetches
 * that as soon as the last question is answered for exactly that reason.
 */
export default function QuizRun({ run }: { run: StartResponse }) {
  const reduced = usePrefersReducedMotion();
  const isMobile = useIsMobile();
  const useField = !isMobile && !reduced;

  const quiz = useQuiz(quizQuestions, run);
  const { phase, index, question, total, picked, isCorrect, pending, error } = quiz;
  const [showBoard, setShowBoard] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  // Guards the window between "warp-out started" and "new panel mounted". Two
  // Next presses inside 400ms would otherwise queue two advances and skip a
  // question.
  const [warping, setWarping] = useState(false);
  const warpingRef = useRef(false);

  const advance = useCallback(() => {
    if (warpingRef.current || phase !== 'feedback') return;
    if (reduced) {
      quiz.next();
      return;
    }
    warpingRef.current = true;
    setWarping(true);

    const stage = stageRef.current;
    const flash = flashRef.current;
    // The flash is the next question's accent, not this one's: it is the light
    // you are arriving in, so it belongs to where you are going.
    // On the last question the next stop is the readout, which has no question
    // accent of its own, so the flash falls back to the site's own pink.
    const nextAccent = quiz.isLast ? '#ff9ffc' : quizQuestions[index + 1].accent;
    const tl = gsap.timeline({
      onComplete: () => {
        warpingRef.current = false;
        setWarping(false);
        quiz.next();
      }
    });
    if (flash) {
      tl.set(flash, {
        background: `radial-gradient(circle at 62% 48%, #ffffff 0%, ${nextAccent} 55%, ${nextAccent} 100%)`
      }, 0).fromTo(flash, { autoAlpha: 0 }, { autoAlpha: 0.55, duration: 0.34, ease: 'power2.in' }, 0.06);
    }
    if (stage) {
      // Same warp-out vocabulary as the event panels: accelerate toward the
      // viewer and blur away. Blur is desktop-only, exactly as on the main page,
      // because a full-viewport re-raster per frame is the phone's worst cost.
      tl.to(
        stage,
        {
          scale: isMobile ? 1.12 : 1.24,
          autoAlpha: 0,
          filter: isMobile ? 'blur(0px)' : 'blur(16px)',
          duration: 0.44,
          ease: 'power3.in'
        },
        0
      );
    }
  }, [index, isMobile, phase, quiz, reduced, total]);

  // ── Warp-in ───────────────────────────────────────────────────────────────
  // Runs on every stop, including the readout and the board. Reads its targets
  // off the panel's `data-warp` hooks so no panel has to thread refs out through
  // forwardRef (the same contract EventDetailsPanel has with JourneySection).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (reduced) {
      gsap.set(stage, { clearProps: 'all' });
      return;
    }

    // Empty selections are dropped rather than passed through: the field variant
    // has no ghost numeral and no blobs, and GSAP logs a "target not found"
    // warning for every empty array it is handed.
    const q = (sel: string) => {
      const found = Array.from(stage.querySelectorAll(sel));
      return found.length ? found : null;
    };
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      const part = (
        sel: string,
        from: gsap.TweenVars,
        to: gsap.TweenVars,
        at: number
      ) => {
        const targets = q(sel);
        if (targets) tl.fromTo(targets, from, to, at);
      };

      tl.fromTo(
        stage,
        { autoAlpha: 0, scale: isMobile ? 1.06 : 1.14, filter: isMobile ? 'blur(0px)' : 'blur(14px)' },
        { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.78, ease: 'power3.out' },
        0
      );
      // Depth first and slowest: the ghost numeral is the heaviest mass on the
      // panel and the last thing to stop moving.
      part('[data-warp="ghost"]', { autoAlpha: 0, scale: 1.4 }, { autoAlpha: 1, scale: 1, duration: 1.25, ease: 'power3.out' }, 0.05);
      part('[data-warp="blobs"]', { autoAlpha: 0, scale: 1.25 }, { autoAlpha: 1, scale: 1, duration: 1, ease: 'power3.out' }, 0.04);
      // Then the content reports in, in reading order.
      part('[data-warp="eyebrow"]', { autoAlpha: 0, yPercent: 70 }, { autoAlpha: 1, yPercent: 0, duration: 0.34, ease: 'power3.out' }, 0.16);
      // The rule wipes rather than fades: a line drawing itself left to right is
      // the beat that says the panel has come online.
      part('[data-warp="rule"]', { scaleX: 0 }, { scaleX: 1, duration: 0.5, transformOrigin: '0% 50%', ease: 'power3.out' }, 0.2);
      // The prompt rises out of its own overflow clip. Transform only, so a
      // display line reveals without repainting the text.
      part('[data-warp="title"]', { yPercent: 120 }, { yPercent: 0, duration: 0.6, ease: 'power4.out' }, 0.18);
      part('[data-warp="tagline"]', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.34, ease: 'power3.out' }, 0.34);
      // Options print in row by row. This is the beat the whole page exists for,
      // so it gets the longest stagger on the panel.
      part(
        '[data-warp="option"]',
        { autoAlpha: 0, yPercent: 38 },
        { autoAlpha: 1, yPercent: 0, duration: 0.36, ease: 'power3.out', stagger: 0.07 },
        0.4
      );
      part('[data-warp="meta"]', { autoAlpha: 0, yPercent: 45 }, { autoAlpha: 1, yPercent: 0, duration: 0.32, ease: 'power3.out', stagger: 0.06 }, 0.48);
      part('[data-warp="cta"]', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 0.62);
      // The flash decays across the arrival rather than before it, so the panel
      // is rushing at the viewer inside the light instead of fading in politely
      // after it.
      if (flashRef.current) tl.to(flashRef.current, { autoAlpha: 0, duration: 0.62, ease: 'power2.out' }, 0);
    }, stage);
    return () => ctx.revert();
  }, [index, isMobile, phase === 'result', showBoard, reduced]);

  // Keyboard: A–D or 1–4 answer the live question. Enter is deliberately not
  // bound here — the Next button takes focus the moment it appears, so Enter is
  // already the browser's own activation and binding it again would fire twice.
  useEffect(() => {
    if (phase !== 'question') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const byLetter = KEY_CODES.indexOf(k);
      const byDigit = /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
      const pickIndex = byLetter >= 0 ? byLetter : byDigit;
      if (pickIndex < 0 || pickIndex >= question.options.length) return;
      e.preventDefault();
      quiz.pick(pickIndex);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, question, quiz]);

  const answered = phase === 'feedback';
  // `isCorrect` is null until the server has ruled, so a pending pick keeps the
  // field in its neutral state rather than guessing a colour it may have to
  // take back.
  const outcome: 'none' | 'correct' | 'wrong' =
    !answered || isCorrect === null ? 'none' : isCorrect ? 'correct' : 'wrong';

  return (
    <>
      {useField && (
        <AsteroidField
          index={phase === 'result' ? total : index}
          total={total}
          accent={phase === 'result' ? '#ff9ffc' : question.accent}
          outcome={outcome}
        />
      )}

      <main className="relative z-10 h-full">
        <div ref={stageRef} className="absolute inset-0 will-change-transform">
          {showBoard ? (
            <Leaderboard onBack={() => setShowBoard(false)} />
          ) : phase === 'result' && quiz.finish ? (
            <ResultPanel
              questions={quizQuestions}
              finish={quiz.finish}
              onLeaderboard={() => setShowBoard(true)}
            />
          ) : phase === 'result' ? (
            // The readout is fetched at the last pick, so this is a sliver — but
            // a dropped connection can hold it open, and a black screen with no
            // word on it reads as a crash.
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-white/35">
                {error ?? 'Compiling your readout…'}
              </p>
            </div>
          ) : (
            <QuestionPanel
              key={question.id}
              question={question}
              index={index}
              total={total}
              answered={answered}
              picked={picked}
              answer={quiz.answer}
              note={quiz.note}
              pending={pending}
              error={error}
              score={quiz.score}
              streak={quiz.streak}
              startedAt={quiz.startedAt}
              variant={useField ? 'field' : 'warp'}
              isLast={quiz.isLast}
              onPick={quiz.pick}
              onNext={advance}
              className={warping ? 'pointer-events-none' : ''}
            />
          )}
        </div>
      </main>

      {/* Accent flash. Screen blend so it glows over the near-black page instead
          of washing it grey, exactly as the journey's warp flash does. */}
      <div ref={flashRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-40 opacity-0 mix-blend-screen" />
    </>
  );
}
