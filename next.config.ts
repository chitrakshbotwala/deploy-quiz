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
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/dor/quiz';

const nextConfig: NextConfig = {
  basePath,
  // firebase-admin resolves gRPC transports and optional native modules through
  // dynamic requires at runtime. Bundling it into the server chunks breaks those;
  // this leaves it as a plain node_modules require.
  serverExternalPackages: ['firebase-admin'],
  eslint: {
    // The port carries the site's own components verbatim. Lint them on their
    // own schedule rather than blocking a deploy on a rule they predate.
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
