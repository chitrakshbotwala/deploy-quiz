# Deploying the quiz on a VPS

Two moving parts now: Next under systemd, and Caddy terminating TLS for
`gdgkiit.in` and proxying `/dor/quiz` to it. The data lives in Firebase, so there
is no database on the box — no Docker, no Postgres, no backup cron, and nothing
listening on loopback but Next itself.

The landing page is **not** here. It stays on Vercel and links across; this
deployment owns exactly one path, and `basePath` in `next.config.ts` is what makes
that true.

## Firebase, first

Nothing below works until the project exists.

1. **Create the project** at console.firebase.google.com.
2. **Authentication → Sign-in method → Google → enable.** Nothing else: the
   server rejects any token whose `sign_in_provider` is not `google.com`. Any
   Google account may play unless `QUIZ_EMAIL_DOMAINS` names domains.
3. **Authentication → Settings → Authorised domains** must list every origin the
   page is served from — `gdgkiit.in` and `localhost`. A missing entry gives
   `auth/unauthorized-domain` in the popup and nowhere else.
4. **Firestore → create database** in production mode, in the region closest to
   the event. Region cannot be changed later.
5. **Project settings → Service accounts → Generate new private key.** That JSON
   is what the server writes with. Treat it as the root password for the data.
6. **Analytics** (optional): link a Google Analytics property, then copy the
   `measurementId` into `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`. Leave it empty and
   analytics is a silent no-op.
6b. **EmailJS** (optional, for telling the finalists): create a service and a
   template, then set the four `EMAILJS_*` variables. Two dashboard settings decide
   whether it works at all — allow API requests from non-browser applications
   (Account → Security), and set the template's **To Email** field to
   `{{to_email}}`. A fixed address there sends all 75 copies to one inbox, so send
   the test message the admin panel asks for before the real one. Free-tier quota is
   200 messages a month; 75 fits, two full retries do not.
7. **Publish the rules.** They deny every client read and write, which is what
   keeps the answer key and everyone else's score out of the browser:

```bash
npx firebase-tools login
npx firebase-tools use <project-id>
npm run rules:deploy          # firestore.rules + firestore.indexes.json
```

Do this **before** the event. A database left in test mode is world-readable to
anyone who lifts the web config out of the page source, and the web config is
public by design.

## First time on the box

```bash
# 1. Code
sudo useradd -r -m -d /srv/dor-quiz gdg
sudo -u gdg git clone git@github.com:SigniorAtif/dor-quiz.git /srv/dor-quiz
cd /srv/dor-quiz && sudo -u gdg npm ci

# 2. Secrets
sudo install -d -m 750 -o root -g gdg /etc/dor-quiz
sudo install -m 640 -o root -g gdg .env.example /etc/dor-quiz/env
sudo openssl rand -hex 32          # paste into SESSION_COOKIE_SECRET
sudo vim /etc/dor-quiz/env         # Firebase web config, service account, ADMIN_PASSWORD
#                                  # AND NEXT_PUBLIC_BASE_PATH=/dor/quiz — see below

# 3. Build. The NEXT_PUBLIC_* values are compiled in HERE, not at runtime, so the
#    env file has to be readable by this command and not only by the service.
sudo -u gdg env $(grep -v '^#' /etc/dor-quiz/env | xargs) npm run build

# 4. Services
sudo cp deploy/dor-quiz.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dor-quiz
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The service refuses to start if the service account, the cookie secret or the
admin password is missing, and it refuses to start if a question file is
malformed. Both are deliberate: the alternative is finding out mid-event.

```bash
journalctl -u dor-quiz -n 20   # [api] ready — served at /dor/quiz — stage1[…]→150 …
```

**Check the mount in that line.** The app defaults to the domain root, because that
is what a developer wants locally; this deployment is not at the root. If
`NEXT_PUBLIC_BASE_PATH=/dor/quiz` was not set *at build time*, the boot log says
`served at /` and every request Caddy forwards will 404 — the symptom looks like a
broken app rather than a missing variable. It is a build-time value, so setting it
afterwards means re-running `npm run build`, not restarting the service.

## Content-Security-Policy

The policy in `Caddyfile` is not decorative and every third-party entry in it is
required by Firebase Auth or Analytics — the comment above it says which does
what. The failure mode of a missing entry is a popup that opens and hangs, with
nothing in the server log, so if sign-in breaks after a policy edit, open the
browser console first.

## Running the event

Everything is driven from `/dor/quiz/admin`. The second round stays shut until the
first cut is frozen, and nothing is open at all until you press start:

0. **Start quiz.** Before this, people can sign in and register — they see
   "waiting for the organisers", and that page opens by itself when you start (it
   polls, so nobody needs telling to refresh). The board shows a live clock from
   the moment you pressed it. **Stop quiz** closes it again: a question already on
   screen still locks and still counts, but no new one is handed out, so those
   sections close and score themselves.
1. Stage 1 opens; participants do section 1, then section 2.
2. When the room is done, **Freeze cut (top 150)** on Stage 1. Everyone below the
   line now sees their rank and a closed door; the top 150 see stage 2 open.
3. Stage 2 runs. Then **Freeze cut (top 75)** — those 75 are the finalists.
4. **Email the 75.** Send yourself a test first — the panel asks for an address —
   then press send and watch it count up. It is paced against EmailJS's rate limit,
   so 75 takes about a minute, and it is safe to stop, resume, or retry: nobody is
   mailed twice.
5. **Stop quiz**, then **Export CSV** for the records.

Freezing also closes out any attempt in that stage still sitting unfinished, so a
participant whose laptop died is ranked on what they answered rather than dropped.

`Undo cut` exists for the cut taken five minutes too early. It reopens the round
and nobody stays eliminated. Re-freezing re-ranks from scratch, including anyone
who finished in between.

The board refreshes itself every 30 seconds while the tab is in front of you.

## Firewall

Do this before the box is reachable, not after.

```bash
sudo ufw default deny incoming
sudo ufw allow 22,80,443/tcp
sudo ufw enable
```

Nothing else needs to be open — Next listens on loopback and Caddy is the only
thing in front of it. Also lock down SSH (`PasswordAuthentication no`, key only)
and install `fail2ban` for sshd.

## Deploying a change

```bash
cd /srv/dor-quiz
sudo -u gdg git pull
sudo -u gdg npm ci
sudo -u gdg env $(grep -v '^#' /etc/dor-quiz/env | xargs) npm run build
sudo systemctl restart dor-quiz
```

There is nothing Caddy picks up on its own — the page is rendered by the Node
process, so a deploy that skips the restart serves the old bundle indefinitely.

## Getting the data out

`/dor/quiz/admin` → **Export CSV**. One block per stage, ranked, with the
per-section breakdown and the frozen cut's in/out column. That is the same data
the board draws, so there is nothing to reconcile.

Backups are Firebase's problem rather than yours now, but the export is worth
taking by hand at the end of each round: it is the only copy that survives someone
deleting the Firestore database.

The gate tells every participant their address stays with the organisers and is
used only for this event. Keeping that promise means deleting the collections
afterwards — `participants`, `sections`, `stages` — from the Firebase console, or:

```bash
npx firebase-tools firestore:delete --recursive participants
npx firebase-tools firestore:delete --recursive sections
npx firebase-tools firestore:delete --recursive stages
```

## Health

```bash
curl -s localhost:3000/dor/quiz/api/health     # {"ok":true}
journalctl -u dor-quiz -f
```
