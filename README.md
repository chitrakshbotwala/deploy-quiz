# Deploy or [REDACTED] — the quiz

Ten questions, one run per person, scored on a server. Next.js (App Router) +
Hono + Postgres, served at **gdgkiit.in/dor/quiz** from a VPS.

The landing page is a separate deployment and stays on Vercel
([SigniorAtif/deploy](https://github.com/SigniorAtif/deploy)); its `/quiz` link
redirects here. This repo owns the quiz and nothing else.

## Why it is its own thing

The quiz used to be a second entry point in the landing page's Vite build. That
worked for as long as the quiz was static. It stopped working the moment the
answers had to leave the bundle: a scored leaderboard needs a database, a
session cookie, and a process that stays up — none of which a static host
provides, and none of which the landing page wants to grow a VPS for. So the two
split along the line that already existed between them.

## Shape

```
app/
  layout.tsx                 fonts (self-hosted via next/font), metadata
  page.tsx                   the only route — renders the client shell
  api/[[...route]]/route.ts  one catch-all, the Hono app mounted behind it
components/quiz/             the run: gate, question panel, readout, board
  AsteroidField.tsx          the WebGL flight (desktop, motion allowed)
server/                      answer key, database, sessions, routes
  answers.ts                 the whole reason there is a server
  types.ts                   the API contract — imported by the client as types
migrations/                  applied at boot, in filename order
```

Two renderers, one engine. `hooks/useQuiz.ts` holds the run state machine and
knows no answers; `components/quiz/QuizRun.tsx` draws it as a WebGL asteroid
field on desktop and as warp panels everywhere else.

### The base path

The app is mounted at `/dor/quiz`, not at a domain root, and three things have
to agree about that: Next's `basePath` (asset URLs), the client's fetch prefix,
and the run cookie's `path`. All three read `lib/basePath.ts`, which reads
`NEXT_PUBLIC_BASE_PATH`. It is a **build-time** value — changing it means
rebuilding, not restarting.

## Local development

```bash
cp .env.example .env.local     # fill in GOOGLE_CLIENT_ID and RUN_COOKIE_SECRET
npm ci
npm run db:up                  # Postgres on 127.0.0.1:5432
npm run dev                    # http://localhost:3000/dor/quiz
```

Migrations run themselves at boot. Sign-in needs a real OAuth client id with
`http://localhost:3000` in its authorised JavaScript origins — there is
deliberately no email fallback, so without one the gate has no way in.

## Editing questions

Question text, options and accent live in `content/quizQuestions.ts`, which is
bundled and public. The correct option and its explanation live in
`server/answers.ts`, which is not. Adding a question means editing **both**,
keyed by the same `id` and in the same order — `assertKeyCoversQuestions()`
refuses to start the server if they drift apart.

## Deploying

See [deploy/README.md](deploy/README.md).
