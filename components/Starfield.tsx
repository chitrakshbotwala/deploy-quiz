import { useEffect, useRef } from 'react';

/**
 * Full-viewport ambient background: near-black base plus a field of twinkling
 * dots (canvas — one rAF loop, no libraries). Fixed layer at z-index -1, no
 * content of its own.
 *
 * It used to also carry three ambient glow layers — a bottom band and a radial
 * climbing each bottom corner. Removed: the wash sat under every scene and
 * tinted the bottom third of the page purple regardless of what was on it.
 */
export default function Starfield({
  count = 200,
  fixed = true,
  mobile = false
}: {
  count?: number;
  /** true (default): standalone fixed z-[-1] layer. false: fill parent
   *  (absolute inset-0) — used when a wrapper controls opacity/z. */
  fixed?: boolean;
  /** Mobile: cap DPR to 1.5 and throttle the redraw to ~30fps so the always-on
   *  canvas doesn't starve the pinned scroll animations of frame budget. */
  mobile?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dprCap = mobile ? 1.5 : 2;
    // Minimum ms between redraws. Desktop draws every frame; mobile throttles to
    // ~30fps to leave headroom for ScrollTrigger's per-frame pin work.
    const minInterval = mobile ? 1000 / 30 : 0;
    let dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    let w = 0;
    let h = 0;

    interface Star {
      x: number; // normalized 0..1
      y: number;
      r: number; // radius px
      min: number; // min opacity
      max: number; // max opacity
      period: number; // ms for a full twinkle cycle
      phase: number; // ms offset so they don't sync
      blue: boolean;
    }

    let stars: Star[] = [];
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const build = () => {
      stars = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: rand(0.6, 1.7),
        min: rand(0.15, 0.28),
        max: rand(0.85, 1),
        period: rand(2000, 5000), // 2–5s
        phase: rand(0, 5000), // randomized delay
        blue: Math.random() < 0.4
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    build();
    resize();

    let raf = 0;
    let lastDraw = -Infinity;
    const render = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        // triangle-ish sine twinkle between min and max
        const phase = ((t + s.phase) % s.period) / s.period; // 0..1
        const k = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2); // 0..1 smooth
        const op = reduced ? (s.min + s.max) / 2 : s.min + (s.max - s.min) * k;
        ctx.globalAlpha = op;
        ctx.fillStyle = s.blue ? '#cfe1ff' : '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - lastDraw < minInterval) return; // throttle (mobile)
      lastDraw = t;
      render(t);
    };
    if (reduced) {
      render(0);
    } else {
      raf = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [count, mobile]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none overflow-hidden ${fixed ? 'fixed inset-0 -z-[1]' : 'absolute inset-0'}`}
      style={{ background: '#050510' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
