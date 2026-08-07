/**
 * Where this app is mounted, and the one place that answers it.
 *
 * Three separate moments need to agree about it:
 *
 *   - build time, so `next.config.ts` can set `basePath` and every asset URL
 *     under /_next comes out prefixed;
 *   - in the browser, so `lib/quizApi.ts` posts to the right /api prefix rather
 *     than to whatever segment the page happens to sit on;
 *   - on the server, so the session cookie is scoped to this path and is not sent
 *     with every unrelated request to the domain.
 *
 * **The default is the domain root**, and a mount point is opt-in. The quiz can be
 * served as a wing of gdgkiit.in at /dor/quiz — that is what production does, and
 * it sets `NEXT_PUBLIC_BASE_PATH=/dor/quiz` in its environment file to say so —
 * but defaulting to it meant `npm run dev` served nothing at `/` and every local
 * visit had to be typed out in full. A default that is wrong on the machine the
 * code is written on is the wrong default.
 *
 * `NEXT_PUBLIC_` so the value survives into the client bundle. It is read at build
 * time, not at runtime — changing the mount point means rebuilding, which is
 * correct, since `basePath` is baked into the emitted asset URLs anyway.
 *
 * Empty string, not `/`: Next rejects `basePath: '/'`, and every consumer here
 * concatenates, so `''` is the value that produces `/api` rather than `//api`.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Where the landing page lives. The nav's in-page anchors resolve against it. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://deployorreadacted.vercel.app').replace(
  /\/$/,
  ''
);
