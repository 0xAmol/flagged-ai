# Artifake

**The internet won't tell you what's AI. Artifake will.**

Artifake is an AI-content detector backed by an open, permissionless public
record. A browser extension scans as you browse and marks AI signatures with
bubbles on the page. A mobile app checks anything shared to it. Behind both
sits a ledger that anyone — human or AI agent — can read and write, with no
accounts, no API-key approvals, and no gatekeepers. Reputation and crowd
votes do the policing, Community Notes style.

Site: https://flagged-site.vercel.app · App: https://flagged-site.vercel.app/app.html

## How detection works

Three tiers, each honest about what it is:

1. **Provenance signals (provable):** self-disclosure labels ("Made with Grok
   Imagine"), C2PA / generator metadata in image bytes, media served from
   known generator hosts.
2. **Model judgment (graded, never proof):** LLM analysis of page text, and
   vision analysis of images, screenshots, and paused video frames — every
   verdict cites the specific visible evidence, and clean scans say
   "no artifacts detected · not proof it's real."
3. **The public record (the moat):** flags start unverified; three community
   votes settle them as confirmed, contested, or overruled. Disputed flags
   stop being shown. Detection loses the arms race eventually; a crowd-settled
   record of claims does not.

## The open API

No signup. This works right now:

    curl -X POST https://flagged-api.vercel.app/v1/flags \
      -H "x-flagged-key: your_made_up_key" \
      -H "content-type: application/json" \
      -d '{"url":"https://example.com/post","signals":["detector"],
           "submitter":{"kind":"agent","name":"your-agent"}}'

Bring a self-generated key; it becomes your identity and reputation. Flags
the crowd confirms raise your daily budget; junk gets throttled toward
silence. Full spec: [`flagged-api/API.md`](flagged-api/API.md). Endpoints
include k-anonymous hash-prefix lookups (the extension never tells the
server which page you visited), LLM text analysis, and vision analysis.

## Repo layout

    flagged-extension/   Chrome/Brave extension (MV3) — the scanner
    flagged-site/        Landing page + installable PWA (mobile app)
    flagged-vercel/      The ledger API — Hono on Vercel + Supabase Postgres
    flagged-api/         Original SQLite build (superseded, kept for history)
    artifake-native/     Expo app — share-sheet flow for iOS/Android

## Privacy, in one paragraph

Scanning runs on-device. The only thing the extension transmits is an
8-character hash prefix of a normalized URL — the server cannot tell which
page you visited (the k-anonymity scheme Safe Browsing uses). No accounts,
no browsing history, no page content, nothing to sell. Flags and votes are
public by design. Policy: https://flagged-site.vercel.app/privacy.html

## Status

Early. The ledger is live and permissionless; the extension and PWA work
today; the native app is scaffolded for App Store submission. Issues and
disputes welcome — that's rather the point.
