import { quickLinks, asteroidHuntUrl, homeUrl } from '@/content/links';
import { BASE_PATH } from '@/lib/basePath';

/**
 * The site nav, as it appears on the quiz.
 *
 * Same bar as the landing page, with one structural difference: every link
 * leaves. On the site the quick links are in-page anchors, but this is a
 * separate deployment on a separate origin, so they are absolute URLs back to
 * the landing page (see content/links.ts). The Quiz entry is the page you are
 * already on, so it is marked `aria-current` and links nowhere.
 */
export default function Nav() {
  // Same order as the landing page's bar, so the numbering matches on both
  // sides of the origin hop: the quick links, then the Asteroid Hunt, then the
  // Quiz last. The Hunt is appended here rather than added to `quickLinks`
  // because that list is anchors-into-the-landing-page and this is a page.
  const links = [
    ...quickLinks,
    { label: 'Asteroid Hunt', href: asteroidHuntUrl },
    { label: 'Quiz', href: BASE_PATH || '/' }
  ];

  return (
    <header id="site-nav" className="fixed inset-x-0 top-0 z-50">
      {/* Vignette scrim so nav stays legible over the starfield */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/85 via-black/50 to-transparent md:h-24 md:from-black/70 md:via-black/35"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 backdrop-blur-[2px] [mask-image:linear-gradient(to_bottom,black,transparent)] md:h-16"
      />
      <nav
        aria-label="Main navigation"
        className="relative flex w-full items-center justify-between px-6 py-7 md:px-14 md:py-9"
      >
        {/* GDG chevron mark. Mark only — the full lockup's "Google Developer
            Groups" wordmark renders too small to earn its space in the nav.

            The src is prefixed by hand: Next rewrites its own asset URLs for
            `basePath` but does nothing to a plain <img>, and an unprefixed
            /gdg-mark.svg would resolve against gdgkiit.in's root, which is not
            this app's territory. */}
        <a
          href={homeUrl}
          className="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white md:gap-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${BASE_PATH}/gdg-mark.svg`}
            alt="Google Developer Groups"
            width={976}
            height={474}
            className="h-6 w-auto md:h-7"
          />
        </a>
        {/* Tightened at md and only opened back up at lg — the same step the
            landing page's bar takes, and for the same reason: six entries at
            gap-9 crowd the mark at 768px. */}
        <div className="hidden items-center gap-7 md:flex lg:gap-9">
          {links.map((link, i) => {
            const isCurrent = link.label === 'Quiz';
            return (
              <a
                key={link.label}
                href={link.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={`group flex items-baseline gap-1.5 font-mono text-sm transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
                  isCurrent ? 'text-white' : 'text-gray-300'
                }`}
              >
                <span className={isCurrent ? 'text-scan-pink' : 'text-scan-pink/70 group-hover:text-scan-pink'}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                {link.label}
              </a>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
