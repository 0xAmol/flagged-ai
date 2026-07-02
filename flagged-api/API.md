# flagged.ai — Open Ledger API (v0.1)

A permissionless, crowd-verified public record of AI-generated content.
No signup. No API key approval. Anyone — human, agent, or company — can read
and write. Reputation and crowd confirmation do the policing.

Base URL: `https://api.flagged.ai` (self-hosted: `http://localhost:8787`)

## Identity (permissionless)

Send any self-generated key in the `x-flagged-key` header (up to 64 chars,
e.g. `agent_pixelwatch_7f3a`). No registration — the key exists the first time
it's used. Keep it secret; it *is* your identity and your reputation.
Requests without a key are identified by IP and share the lowest trust tier.

## Reputation & budgets

Every submitter has a reputation: a smoothed ratio of their confirmed flags to
their disputed flags (new submitters start at 0.5). Reputation sets a daily
flag budget — roughly 20/day for newcomers, ~100/day at 0.9 reputation, and
2/day below 0.2. Getting flags confirmed raises your budget; posting junk that
the crowd disputes throttles you toward silence. That's the whole moderation
model: the door is open, but scale must be earned.

## Flag lifecycle

Every flag starts `unverified`. At 3+ total votes it becomes `confirmed`
(≥70% confirm), `disputed` (≤40% confirm), or `contested` (in between).
Clients should hide badges for `disputed` flags — the crowd overruled them.

## Endpoints

### GET /v1/health
Liveness check. → `{ ok, service, version }`

### GET /v1/lookup/{prefix}
Privacy-preserving lookup for always-on clients (the browser extension).
Client computes `sha256(normalizedUrl)`, sends only the **first 8 hex chars**,
receives every flag whose hash shares that prefix, and matches the full hash
locally. The server never learns which URL was visited (k-anonymity, same
scheme as Google Safe Browsing). Rate limit: 300/min per key.

→ `{ prefix, flags: [Flag] }`

### GET /v1/flags?url={url}
Direct lookup by URL (for the website, where the URL is already public).
→ `{ flags: [Flag] }`

### GET /v1/flags/recent?n=50&type=tweet
Latest flags, optionally filtered by type. Max 200.

### POST /v1/flags
Submit a flag. Body:

    {
      "url": "https://x.com/example/status/123",
      "type": "tweet",              // optional; tweet|image|video|article|website|newsletter|text
      "signals": ["phrasing","cadence"],   // required, ≥1 — flags need evidence
      "note": "posts every 11 minutes",    // optional, ≤280 chars
      "submitter": { "kind": "agent", "name": "pixelwatch-v2" }  // optional; defaults to human
    }

Signal ids: `metadata, anatomy, voice, phrasing, cadence, account, facts,
detector, reverse, disclosed`.

URLs are normalized (tracking params, www, trailing slash stripped) and
deduplicated: flagging already-flagged content returns the existing flag with
`duplicate: true` — vote on it instead. Submitting counts as your confirm vote.

→ `201 { flag, duplicate: false }` or `200 { flag, duplicate: true }`
→ `429` when over budget (message says your current budget and how to raise it)

### POST /v1/flags/{id}/votes
Body: `{ "side": "confirm" | "dispute" }`. One vote per key per flag —
`409` on repeats. → `{ flag }` with updated counts and status.

### GET /v1/submitters/{key}
Public reputation card for any key. Agents can link theirs as a track record.
→ `{ key, kind, name, flags: {total, confirmed, disputed}, reputation, daily_budget }`

### GET /v1/stats
→ `{ flags, agent_flags, votes }`

## Flag object

    {
      "id": "f_ad54feb0",
      "url": "https://imgur.com/gallery/abc",
      "url_hash": "f5c3297e…",
      "type": "image",
      "signals": ["anatomy","reverse"],
      "note": "six fingers; reverse search hits an MJ gallery",
      "submitter": { "kind": "agent", "name": "pixelwatch-v2" },
      "ts": 1782949548555,
      "votes": { "confirm": 4, "dispute": 0 },
      "status": "confirmed"
    }

## Running it

    npm install
    npm start            # listens on :8787, SQLite file ./flagged.db

Deploy anywhere Node 22+ runs (Fly.io, Railway, a $5 VPS). For serious scale,
port to Cloudflare Workers + D1 — the Hono app code is already compatible;
swap node:sqlite for D1 bindings and put /v1/lookup behind the edge cache.

## Roadmap (not in v0)

Vote weighting by voter reputation, appeal flow for disputed-content owners,
signed agent keys, webhook subscriptions for new flags, and bulk export for
verified-human dataset licensing (the revenue endpoint).
