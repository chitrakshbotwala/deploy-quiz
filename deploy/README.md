# Deploying the quiz on a VPS

Three moving parts: Postgres in Docker, Next under systemd, Caddy terminating
TLS for `gdgkiit.in` and proxying `/dor/quiz` to it. Nothing else runs on the
box.

The landing page is **not** here. It stays on Vercel and links across; this
deployment owns exactly one path, and `basePath` in `next.config.ts` is what
makes that true.

## First time

```bash
# 1. Code
sudo useradd -r -m -d /srv/dor-quiz gdg
sudo -u gdg git clone git@github.com:SigniorAtif/dor-quiz.git /srv/dor-quiz
cd /srv/dor-quiz && sudo -u gdg npm ci

# 2. Secrets
sudo install -d -m 750 -o root -g gdg /etc/dor-quiz
sudo install -m 640 -o root -g gdg .env.example /etc/dor-quiz/env
sudo openssl rand -hex 32          # paste into RUN_COOKIE_SECRET
sudo vim /etc/dor-quiz/env         # DATABASE_URL, POSTGRES_PASSWORD, GOOGLE_CLIENT_ID

# 3. Database. Compose reads POSTGRES_PASSWORD from ./.env, so symlink the
#    same file rather than keeping two copies of the password.
sudo ln -s /etc/dor-quiz/env /srv/dor-quiz/.env
sudo -u gdg docker compose up -d
# Schema is applied by the app itself at boot (instrumentation.ts → migrate()).

# 4. Build. The NEXT_PUBLIC_* values are compiled in here, so the env file has
#    to be readable by this command, not just by the service.
sudo -u gdg env $(grep -v '^#' /etc/dor-quiz/env | xargs) npm run build

# 5. Services
sudo cp deploy/dor-quiz.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dor-quiz
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Google OAuth

Authorised JavaScript origins in the GCP console are **scheme + host only** —
the `/dor/quiz` path is not part of an origin and adding it is rejected:

```
https://gdgkiit.in        production
http://localhost:3000     next dev
```

No redirect URIs. No client secret; the ID-token flow does not use one.

## Firewall

Do this before the box is reachable, not after.

```bash
sudo ufw default deny incoming
sudo ufw allow 22,80,443/tcp
sudo ufw enable
```

`ufw` alone does **not** protect Docker-published ports — Docker writes its own
iptables rules ahead of ufw's chain. That is why `docker-compose.yml` publishes
Postgres as `127.0.0.1:5432:5432` and not `5432:5432`. Verify it after every
compose change:

```bash
ss -tlnp | grep 5432     # must show 127.0.0.1:5432, never 0.0.0.0:5432
```

Also lock down SSH (`PasswordAuthentication no`, key only) and install
`fail2ban` for sshd.

## Deploying a change

```bash
cd /srv/dor-quiz
sudo -u gdg git pull
sudo -u gdg npm ci
sudo -u gdg env $(grep -v '^#' /etc/dor-quiz/env | xargs) npm run build
sudo systemctl restart dor-quiz
```

Unlike the old static build, there is nothing Caddy picks up on its own — the
page is rendered by the Node process, so a deploy that skips the restart serves
the old bundle indefinitely.

## Backups

You own these now. Nightly dump, kept 14 days:

```
0 3 * * * cd /srv/dor-quiz && docker compose exec -T db pg_dump -U gdg -d gdg_quiz | gzip > /var/backups/gdg-$(date +\%F).sql.gz
0 4 * * * find /var/backups -name 'gdg-*.sql.gz' -mtime +14 -delete
```

Take one by hand before the event starts, and restore it once somewhere else to
confirm the dump is actually readable. An untested backup is not a backup.

## Getting the participant list out

Name and email come from the signed-in Google account. `roll` is in the schema
but never populated — sign-in yields no roll number — so it is left out here;
KIIT addresses are roll-derived if you need one.

```bash
docker compose exec -T db psql -U gdg -d gdg_quiz -c "\copy ( \
  select p.name, p.email, r.score, \
         round(extract(epoch from (r.finished_at - r.started_at))) as seconds \
    from runs r join participants p on p.id = r.participant_id \
   where r.finished_at is not null \
   order by r.score desc, (r.finished_at - r.started_at) asc \
) to stdout with csv header" > participants.csv
```

The gate tells every visitor this data is deleted after the event. Keep that
promise:

```sql
truncate picks, runs, participants restart identity cascade;
```

## Health

```bash
curl -s localhost:3000/dor/quiz/api/health     # {"ok":true}
journalctl -u dor-quiz -f
docker compose logs -f db
```
