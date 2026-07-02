# flagged.ai on Vercel + Supabase

Same open ledger, same endpoints, same permissionless mechanics as the local
SQLite build — with Supabase Postgres as the database and Vercel serverless
functions as the API. (The SQLite version can't run on Vercel: serverless has
no persistent disk.)

## 1. Supabase (the database)

1. supabase.com -> New project -> name it `flagged` (any region close to you).
2. SQL Editor -> New query -> paste the whole contents of `schema.sql` -> Run.
   You should see "Success" and three tables appear under Table Editor.
3. Get the connection string: Project Settings -> Database -> Connection string
   -> select **Transaction pooler** (port 6543) -> copy the URI. It looks like:
   postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   Replace [YOUR-PASSWORD] with your database password.
   The transaction pooler matters: serverless functions open many short
   connections, and the pooler is built for exactly that. The API already sets
   prepare:false, which the pooler requires.

## 2. Vercel (the API)

1. Push this folder to GitHub (its own repo, or a folder in flagged-ai).
2. vercel.com -> Add New -> Project -> import the repo.
   If this folder isn't the repo root, set Root Directory to it.
3. Environment Variables -> add:
   DATABASE_URL = (the pooler URI from step 1.3)
4. Deploy. Your API is live at https://your-project.vercel.app

## 3. Verify

    curl https://your-project.vercel.app/v1/health
    -> {"ok":true,"service":"flagged.ai ledger","version":"0.2.0","db":"postgres"}

    curl -X POST https://your-project.vercel.app/v1/flags \
      -H "content-type: application/json" -H "x-flagged-key: test_1" \
      -d '{"url":"https://example.com/x","signals":["phrasing"]}'

Check Supabase Table Editor -> flags: your row is there.

## 4. Point the extension at it

In flagged-extension/db.js, first line of config:
    const API = "https://your-project.vercel.app";
In flagged-extension/manifest.json, host_permissions: replace the
localhost entry with "https://your-project.vercel.app/*".
Reload the extension at chrome://extensions.

## 5. Custom domain (optional but nice)

Vercel -> your project -> Settings -> Domains -> add api.flagged.ai
(or whatever domain you bought). Then use that in db.js instead.

## Local development

    DATABASE_URL="postgres://..." node dev.js
    # same app, served on :8787 without Vercel

## Notes

- RLS is enabled on all tables with no policies, which locks them away from
  Supabase's auto-generated public REST API. Your Vercel functions connect as
  the postgres role (table owner), which bypasses RLS — that's intended.
- Burst limits are database-backed (10 flags/min, 60 votes/min per key)
  because serverless instances don't share memory. The reputation-scaled
  daily budget works exactly as before.
- /v1/lookup responses carry Cache-Control s-maxage=60, so Vercel's edge CDN
  absorbs repeat lookups — that's what keeps an always-on extension cheap.
- Free tiers of both services comfortably cover launch. Supabase free pauses
  after a week of inactivity; the first real traffic keeps it warm, or
  upgrade to Pro ($25/mo) when it matters.
