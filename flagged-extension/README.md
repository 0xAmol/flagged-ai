# flagged.ai extension v0.3 — the VPN model

Turn it on, browse, and AI signatures get marked with bubbles right on the page.
Turn it off and it does nothing at all.

## What changed from v0.2
- Popup is now a power toggle (VPN-style): Not scanning / Scanning on,
  with session stats (pages scanned, signatures found).
- When ON, the content scanner marks signatures with clickable bubbles:
  * Provenance signals (hard): media served from known generator hosts,
    self-disclosure text like "Made with Grok Imagine"
  * Heuristic hints: LLM phrasing tells (2+ tells required), clearly labeled
    "pattern match, not proof"
  * Community record: pages already on the flagged.ai ledger
- Every bubble opens a card showing the signatures, the evidence, and an
  honesty grade (provenance / community / heuristic / LLM judgment).
- Community notes is the secondary layer inside each card: add the finding
  to the public record, or confirm/dispute existing flags.
- "Deep scan this page" in the popup sends the page's main text to the
  ledger's /v1/analyze endpoint for LLM signature analysis. This only works
  once the server operator enables it (see below); until then the button
  explains it's not enabled.

## Install / update
chrome://extensions -> Developer mode -> Load unpacked -> this folder.
(If updating over v0.2, just hit the reload arrow after replacing files.)

## Enabling LLM analysis on the server
In the flagged-api Vercel project, add environment variables:
  ANTHROPIC_API_KEY   = your key from console.anthropic.com
  ANALYZE_MODEL       = claude-haiku-4-5        (default; cheap + fast)
  ANALYZE_DAILY_PER_KEY = 50                    (per-user daily cap)
  ANALYZE_DAILY_GLOBAL  = 1000                  (kill-switch for your bill)
Then redeploy the API (npx vercel --prod from flagged-vercel).
Cost ballpark with haiku: a fraction of a cent per analysis; the global cap
bounds worst-case spend per day.
