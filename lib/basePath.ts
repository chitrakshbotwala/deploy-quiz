/**
 * Where this app is mounted, and the one place that answers it.
 *
 * The quiz does not own a domain — it is a wing of gdgkiit.in, served at
 * /dor/quiz while the landing page stays on Vercel. Next needs to know that at
 * three separate moments and they must agree:
 *
 *   - build time, so `next.config.ts` can set `basePath` and every asset URL
 *     under /_next comes out prefixed;
 *   - in the browser, so `lib/quizApi.ts` posts to /dor/quiz/api rather than to
 *     the domain root, which is the landing page's territory;
 *   - on the server, so the run cookie is scoped to this path and is not sent
 *     with every unrelated request to gdgkiit.in.
 *
 * `NEXT_PUBLIC_` so the value survives into the client bundle. It is read at
 * build time, not at runtime — changing the mount point means rebuilding, which
 * is correct, since `basePath` is baked into the emitted asset URLs anyway.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/dor/quiz';

/** Where the landing page lives. The nav's in-page anchors resolve against it. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://deployorredacted.vercel.app').replace(
  /\/$/,
  ''
);
