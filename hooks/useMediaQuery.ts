import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

// "Mobile" = the lighter path (native scroll, no ScrollSmoother, lightened
// warps). Trigger it for ANY touch device (pointer: coarse) as well as narrow
// screens — not just <768px. A large phone, a phone in landscape, or a tablet
// all report widths >767 but are still touch devices where the desktop
// ScrollSmoother choreography is laggy and leaves a transformed black gap.
export const useIsMobile = () => useMediaQuery('(max-width: 1024px), (pointer: coarse)');
