# Deploy or [REDACTED] — the quiz

Ten questions, one at a time, scored in the tab. Next.js (App Router), no
database and no API — the whole run is a state machine and two renderers.

The landing page is a separate deployment
([SigniorAtif/deploy](https://github.com/SigniorAtif/deploy)); its `/quiz` link
points here. This repo owns the quiz and nothing else.

> The scored, signed-in version — Google sign-in, a Postgres-backed leaderboard,
> one attempt per person — lives on the **`feat/quizbackend`** branch. This
> branch is the frontend on its own: it keeps the answers in the bundle, which
> is fine for a quiz nobody is ranked on and fatal for one that is.

## Shape

```
app/
  layout.tsx                 fonts (self-hosted via next/font), metadata
  page.tsx                   the only route — renders the client shell
components/quiz/             the run: question panel, readout
  AsteroidField.tsx          the WebGL flight (desktop, motion allowed)
content/quizQuestions.ts     every question, answer and note — the file to edit
hooks/useQuiz.ts             the run state machine
```

Two renderers, one engine. `hooks/useQuiz.ts` holds the run state and owns no
DOM; `components/quiz/QuizApp.tsx` draws it as a WebGL asteroid field on desktop
and as warp panels everywhere else, so both share the engine verbatim and differ
only in how they draw the same run.

Reduced motion gets the panels with no warp at all, which is the end state of
both: the question is simply there.

### The base path

The app is mounted at `/dor/quiz`, not at a domain root, so Next's `basePath`
and anything that builds a URL by hand have to agree about that. Both read
`NEXT_PUBLIC_BASE_PATH` through `lib/basePath.ts`. It is a **build-time** value —
changing it means rebuilding, not restarting.

## Local development

```bash
cp .env.example .env.local
npm ci
npm run dev                    # http://localhost:3000/dor/quiz
```

## Editing questions

Everything is in `content/quizQuestions.ts`: prompt, options, the correct index,
the note shown after answering, and the `accent` that colours the panel, the
point light on the asteroid you are parked at, and the warp streaks you fly
through. Keep new accents inside the site's muted palette and clear of the two
signal colours, or a correct/incorrect read becomes ambiguous.

The answers are in the bundle. Anyone who opens devtools can read them — which
is exactly why the scored version moved them to a server.
