import type { NextConfig } from 'next';

/**
 * The quiz is served at gdgkiit.in/dor/quiz, not at a domain root, so `basePath`
 * is load-bearing: without it every /_next/... asset URL Next emits would point
 * at gdgkiit.in's root and 404 behind the reverse proxy.
 *
 * Kept in step with lib/basePath.ts through the same environment variable, so
 * the client's fetch prefix and the server's cookie scope can never disagree
 * with the router.
 *
 * Deliberately NOT `output: 'standalone'`. Standalone trims node_modules to what
 * the server actually reaches, which is worth it when you ship an image; here
 * the VPS holds the repo and runs `npm ci`, so it would buy nothing and cost a
 * manual copy of .next/static and public/ into the standalone tree on every
 * deploy — a step that fails silently by serving a page with no CSS.
 */
/**
 * Root by default, mount point opt-in. Kept in step with lib/basePath.ts through
 * the same variable — see the note there for why the default flipped.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The mount point this app used to default to, and still uses in production. */
const LEGACY_MOUNT = '/dor/quiz';

const nextConfig: NextConfig = {
  basePath,

  /**
   * When served from the root, the old mount point still resolves.
   *
   * Every bookmark, every QR code already printed, and every link in a chat from
   * before this change points at /dor/quiz. A 308 keeps the method and body, so
   * even a POST to the old /dor/quiz/api/... lands correctly — though the client
   * never sends one, since it builds its own prefix from the same variable.
   *
   * Skipped entirely when a basePath IS set, where these would be a redirect loop.
   */
  async redirects() {
    if (basePath) return [];
    return [
      { source: LEGACY_MOUNT, destination: '/', permanent: true },
      { source: `${LEGACY_MOUNT}/:path*`, destination: '/:path*', permanent: true }
    ];
  },
  // firebase-admin resolves gRPC transports and optional native modules through
  // dynamic requires at runtime. Bundling it into the server chunks breaks those;
  // this leaves it as a plain node_modules require.
  serverExternalPackages: ['firebase-admin'],
  // Nothing needs to know which framework serves this, and a version number in a
  // response header is free reconnaissance.
  poweredByHeader: false,
  eslint: {
    // The port carries the site's own components verbatim. Lint them on their
    // own schedule rather than blocking a deploy on a rule they predate.
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
