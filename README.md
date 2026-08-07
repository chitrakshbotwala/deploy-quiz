# Deploy or [REDACTED] — the quiz

A two-round selection quiz. Ten seconds a question, scored on a server, one
attempt per person per section, and no leaderboard anyone but the organisers can
see. Next.js (App Router) + Hono + Firebase (Auth, Firestore, Analytics), served
at **gdgkiit.in/dor/quiz** from a VPS.

The landing page is a separate deployment and stays on Vercel
([SigniorAtif/deploy](https://github.com/SigniorAtif/deploy)); its `/quiz` link
redirects here. This repo owns the quiz and nothing else.

## The flow

```
sign in (Google, via Firebase)
      │
      ├─ Stage 1 ── Section 1 ──► Section 2          everyone
      │                 │
      │        organiser freezes the cut: top 150 by score,
      │        ties broken by the faster total answering time
      │                 │
      │        ┌────────┴────────┐
      │      in top 150      below it
      │        │                 └─► "Sorry — your rank was 151, and you are
      │        │                      not eligible for Stage 2."
      ├─ Stage 2 ── Section 1                        the 150
      │                 │
      │        organiser freezes the cut: top 75
      │                 │
      └────────────► the finalists
```

Both cutoffs are environment variables (`STAGE1_CUTOFF`, `STAGE2_CUTOFF`) and
both cuts are taken by hand from `/dor/quiz/admin`. That is deliberate — see
"Why the cut is a moment" below.

## Starting and stopping it

The quiz is idle until an organiser presses **Start quiz** on `/dor/quiz/admin`,
and sign-in does not wait on that: people register beforehand, land on their
ladder, and see *"Waiting for the organisers to start the quiz."* That page polls,
so it opens by itself when the button is pressed — nobody has to be told to
refresh a hall full of laptops.

**Stop quiz** shuts the door on new sections and new questions. It deliberately
does **not** cancel a question already on someone's screen: the lock still lands
and counts, because throwing away an answer somebody already gave is worse than
ending a section early. What it does not do is hand back another question — so the
section closes, scores, and is ranked. Someone whose tab died mid-section can still
reopen it after a stop for exactly that reason; they get no new question, just the
chance to close out. Resuming keeps the original start time, so the elapsed clock
on the board measures the event.

Freezing a cut closes any attempt in that stage that was started and never
finished, before it ranks anyone. An unfinished attempt has no stage total and so
would not be ranked at all — dropping a participant from the event for a dead
laptop is not a result anybody wants.

## Rules the server enforces

Every one of these is enforced server-side, and the browser only draws it:

- **Ten seconds a question.** A question is handed out with a server-stamped
  deadline. Refreshing returns the *same* deadline, so a reload cannot buy more
  time, and a lock that arrives late is recorded as no answer at all.
- **Select, then lock.** Clicking an option only selects it. It is committed when
  Continue is pressed or when the clock runs out — so a misclick is recoverable
  right up to the deadline.
- **One attempt per section per account.** The attempt's document id *is* the
  participant's Firebase uid, so a second attempt is the same document, and the
  write that would open it is a transaction that refuses to overwrite a finished
  one. Signing out and back in with the same account resumes; the account is the
  identity, not the browser.
- **Ranking is score, then time.** Time is the sum of per-question answering time,
  not wall clock: a locked phone or a slow network cannot inflate it. A question
  never served is charged its full budget, so walking away is never the fastest
  run.
- **No answers, ever, to anyone.** Not per question, not in the readout. A
  participant sees their total and their time. Nobody sees anybody else's row.

## Why the cut is a moment

A live "am I in the top 150?" flickers — true at 19:04, false at 19:06, because
somebody else finished. Someone could start round two and be barred halfway
through it. So eligibility is frozen: an organiser presses a button, everyone who
finished the stage is ranked, and the result is written down with a timestamp.
That is also the only way to tell the 151st participant a rank that will not move
under them.

`Undo cut` exists for the cut taken too early. Re-freezing re-ranks from scratch.

## Shape

```
app/
  page.tsx                   the participant app (one route, no navigation)
  admin/page.tsx             the organisers' board, behind one password
  api/[[...route]]/route.ts  one catch-all, the Hono app mounted behind it
data/questions/*.json        ── EDIT ME ── questions, answers, per-question budget
components/quiz/             gate → ladder → section → readout / eliminated
  AsteroidField.tsx          the WebGL flight (desktop, motion allowed)
components/admin/            the leaderboard, the cut buttons, the CSV export
hooks/useSection.ts          the run state machine. Knows no answers.
server/
  quiz.ts                    reads the JSON, strips the answers, holds the ladder
  store.ts                   every Firestore read and write, and the ranking
  firebase.ts                Admin SDK: token verification and the DB handle
  routes.ts                  the API
  types.ts                   the contract — imported by the client as types
firestore.rules              deny all. The browser never touches Firestore.
```

Two renderers, one engine: `hooks/useSection.ts` holds the run and knows no
answers; `components/quiz/SectionRun.tsx` draws it as a WebGL asteroid field on
desktop and as warp panels everywhere else.

### Where the answers live

`data/questions/*.json` carries the correct option and a note for each question.
That directory is read by `server/quiz.ts` and is **never** imported by a client
component: the browser is served a copy with `answer` and `note` stripped, by the
same function that reads the file. Add a question by editing one JSON file — there
is no second list to keep in sync, and the server refuses to boot if a file is
malformed or an answer index is out of range.

The verdict is recorded in Firestore and never returned. `firestore.rules` denies
every client read and write, so a signed-in browser cannot read its own attempt
document, let alone the field that says whether it was right.

### Adding or changing a section

`data/questions/` holds one file per section; `STAGES` in `server/quiz.ts` says
which sections belong to which stage and in what order. A new section is a new
file plus one id in that array. `secondsPerQuestion` is per section.

## Local development

```bash
cp .env.example .env.local     # then fill it in — see below
npm ci
npm run dev                    # http://localhost:3000/dor/quiz
```

`.env.local` needs a real Firebase project: the web config (public, inlined into
the bundle at build time) and a service-account key (secret, server-only). There
is deliberately no email fallback and no emulator shortcut wired in, so without a
project the gate has no way in. `deploy/README.md` has the console walkthrough.

Sign-in is open to **any Google account** by default (`QUIZ_EMAIL_DOMAINS` empty).
Set a domain list there to get the hard one-attempt-per-person guarantee back —
see the note in `.env.example` for what leaving it open costs.

`localhost` must be in **Authentication → Settings → Authorised domains**, or the
popup fails with `auth/unauthorized-domain`.

`dev` runs on Turbopack, and that is load-bearing rather than a preference. Next
compiles `instrumentation.ts` for the edge runtime as well as for Node, and the
Node-only imports in it (`node:fs`, `firebase-admin`) fail that compile under
webpack; Turbopack skips it.

### The base path

The app is mounted at `/dor/quiz`, not at a domain root, and three things have to
agree about that: Next's `basePath` (asset URLs), the client's fetch prefix, and
the cookies' `path`. All three read `lib/basePath.ts`, which reads
`NEXT_PUBLIC_BASE_PATH`. It is a **build-time** value — changing it means
rebuilding, not restarting.

## The admin board

`/dor/quiz/admin`, one password (`ADMIN_PASSWORD`), compared in constant time
behind a six-attempts-per-hour per-IP limit. The session is a signed cookie that
ages out in four hours.

It is the only leaderboard in the app. No participant-facing route returns another
participant's row, a rank other than their own, or any score but their own total.
The board is also where the quiz is started and stopped — with a clock showing how
long it has been running — where the cuts are taken, and where the CSV comes from.

## Data, and deleting it

Firestore, all of it written by the API:

```
event/state                                         started, stopped, when
participants/{uid}                                  who signed in
sections/{sectionId}/attempts/{uid}                 one attempt, ever
sections/{sectionId}/attempts/{uid}/answers/{qId}   one lock, ever
stages/{stageId}/standings/{uid}                    the stage total
stages/{stageId}/cutMembers/{uid}                   the frozen cut, ranked
```

Ranking folds score-descending and time-ascending into one ascending `sortKey`
string, written only once a participant has finished every section in the stage.
Firestore skips documents that lack the field being ordered, so "rank the people
who finished" needs no filter and therefore no composite index — which is why
`firestore.indexes.json` is empty.

The gate promises participants their address stays with the organisers and is used
only for this event. `deploy/README.md` has the commands that keep that promise.
