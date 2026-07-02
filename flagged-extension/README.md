# flagged.ai extension (v0.2 — ledger-connected)

Same install as before: chrome://extensions -> Developer mode -> Load unpacked.

New in v0.2: db.js now talks to the flagged.ai open ledger API.
- Lookups are k-anonymous: only an 8-char hash prefix of the page URL is sent;
  full matching happens on your device. Page content never leaves the browser.
- Your identity is a self-generated key created on first run (permissionless).
- If the API is unreachable, everything falls back to local storage, and
  flags you make offline are kept locally.

Point it at your deployment by editing one line at the top of db.js:
  const API = "http://localhost:8787";   // -> https://api.flagged.ai
