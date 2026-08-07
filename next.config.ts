import type { NextConfig } from 'next';

/**
 * The quiz is served at gdgkiit.in/dor/quiz, not at a domain root, so `basePath`
 * is load-bearing: without it every /_next/... asset URL Next emits would point
 * at gdgkiit.in's root and 404 behind the reverse proxy.
 *
 * Kept in step with lib/basePath.ts through the same environment variable, so
 * the router and anything that builds a URL by hand can never disagree.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/dor/quiz';

const nextConfig: NextConfig = {
  basePath,
  eslint: {
    // The port carries the site's own components verbatim. Lint them on their
    // own schedule rather than blocking a deploy on a rule they predate.
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
