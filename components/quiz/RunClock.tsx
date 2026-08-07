import { useEffect, useState } from 'react';

/**
 * Elapsed-time readout for the telemetry rail.
 *
 * It owns its own tick deliberately. Hoisting the seconds into the quiz state
 * would re-render the panel, the option rows, and the asteroid field's React
 * wrapper once a second for a two-digit change in one corner of the screen —
 * a per-second invalidation running underneath a WebGL flight tween.
 */
export default function RunClock({ startedAt, stoppedAt }: { startedAt: number; stoppedAt: number | null }) {
  const [now, setNow] = useState(() => stoppedAt ?? Date.now());

  useEffect(() => {
    if (stoppedAt !== null) {
      setNow(stoppedAt);
      return;
    }
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [stoppedAt, startedAt]);

  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return (
    <time dateTime={`PT${total}S`}>
      {mm}:{String(ss).padStart(2, '0')}
    </time>
  );
}
