-- Quiz backend schema.
--
-- Three tables, and the constraints are the enforcement — not the application
-- code. "One attempt per person" is `runs.participant_id unique`, and "you
-- cannot re-answer a question" is `picks (run_id, q_id)` as the primary key.
-- Both hold even if a request races itself or the API is restarted mid-run.

create extension if not exists "pgcrypto";

create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  email       text        not null,
  -- Not collected any more: sign-in yields no roll number. Kept nullable so the
  -- organisers' export can be backfilled by hand if they want it.
  roll        text,
  -- The identity. Google's stable per-account subject, taken from a token Google
  -- signed — not from anything the visitor typed. This being the primary key of
  -- who-you-are is what makes "one attempt per person" a real statement rather
  -- than a hope about email addresses.
  google_sub  text        not null unique,
  created_at  timestamptz not null default now()
);

-- Case-insensitive, and a backstop rather than the identity: one Workspace
-- account has one address, so this should never be the constraint that fires.
create unique index if not exists participants_email_key on participants (lower(email));

create table if not exists runs (
  id             uuid primary key default gen_random_uuid(),
  -- One attempt per person, enforced here rather than checked in the route.
  participant_id uuid        not null unique references participants (id) on delete cascade,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  score          int,
  best_streak    int,
  -- Kept for abuse triage after the event, not for identity.
  ip             inet,
  user_agent     text
);

create table if not exists picks (
  run_id      uuid        not null references runs (id) on delete cascade,
  q_id        text        not null,
  choice      int         not null,
  correct     boolean     not null,
  answered_at timestamptz not null default now(),
  primary key (run_id, q_id)
);

-- Leaderboard read path: finished runs, best score first, then fastest.
create index if not exists runs_leaderboard_idx
  on runs (score desc, (finished_at - started_at) asc)
  where finished_at is not null;
