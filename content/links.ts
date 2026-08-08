import { SITE_URL } from '@/lib/basePath';

// ─── EDIT ME ─────────────────────────────────────────────────────────────────
// The nav's links. The quiz is a separate deployment from the landing page, so
// unlike on the site itself these cannot be in-page anchors: `#events` in this
// document resolves to nothing. Each one is absolute against the landing page's
// origin, which lives in NEXT_PUBLIC_SITE_URL.

export interface NavLink {
  label: string;
  href: string;
}

export const quickLinks: NavLink[] = [
  { label: 'About', href: `${SITE_URL}/#about` },
  { label: 'Events', href: `${SITE_URL}/#events` },
  { label: 'Gallery', href: `${SITE_URL}/#gallery` },
  { label: 'Evidence', href: `${SITE_URL}/#evidence` }
];

/**
 * The Asteroid Hunt campaign page. On the landing page it is a real route — its
 * own document, not an anchor — so from here it is that origin plus the path.
 * Nothing in this deployment serves it.
 *
 * The spelling is deliberate: the built document is `astriodhunt/index.html`
 * and that is the URL in the wild. The landing page redirects /asteroidhunt and
 * /asteroid-hunt to it, so a corrected guess still lands, but linking at the
 * real path saves the hop.
 */
export const asteroidHuntUrl: string = `${SITE_URL}/astriodhunt`;

/** External registration link used by the nav's CTA. */
export const registerUrl: string =
  process.env.NEXT_PUBLIC_REGISTER_URL ?? 'https://gdg.community.dev/gdg-on-campus-kiit/';

/** Home, for the wordmark in the corner. */
export const homeUrl: string = SITE_URL;
