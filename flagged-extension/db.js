// db.js — flagged.ai data layer, API-backed.
// Talks to the open ledger with k-anonymous lookups (hash prefix only).
// Falls back to chrome.storage.local when the API is unreachable, so the
// extension keeps working offline / before you've deployed the backend.

const FlagDB = (() => {
  const API = "http://localhost:8787"; // <- set to https://api.flagged.ai when deployed
  const KEY_STORE = "flagged_identity_key";
  const LOCAL_KEY = "flagged_local_flags";
  const VOTES_KEY = "flagged_my_votes";

  // ---- identity: self-generated, permissionless ----
  let _identity = null;
  async function identity() {
    if (_identity) return _identity;
    const r = await chrome.storage.local.get(KEY_STORE);
    if (r[KEY_STORE]) return (_identity = r[KEY_STORE]);
    const key = "ext_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    await chrome.storage.local.set({ [KEY_STORE]: key });
    return (_identity = key);
  }

  // ---- url handling (must match server normalization) ----
  const STRIP = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","ref","s","t","si","igsh"];
  function normalizeUrl(raw) {
    try {
      const u = new URL(raw);
      const params = new URLSearchParams(u.search);
      STRIP.forEach((p) => params.delete(p));
      const q = params.toString();
      return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + (q ? "?" + q : "")).toLowerCase();
    } catch { return raw.toLowerCase(); }
  }

  async function sha256hex(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function detectType(url) {
    const u = url.toLowerCase();
    if (/(twitter\.com|x\.com)\//.test(u)) return "tweet";
    if (/(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)/.test(u)) return "video";
    if (/(substack\.com|beehiiv\.com|buttondown|mailchi\.mp)/.test(u)) return "newsletter";
    if (/(\.jpg|\.jpeg|\.png|\.webp|\.gif|imgur\.com|instagram\.com|midjourney|civitai)/.test(u)) return "image";
    if (/(medium\.com|nytimes|washingtonpost|theatlantic|wired\.com|blog)/.test(u)) return "article";
    return "website";
  }

  const SIGNALS = [
    { id: "metadata", label: "Metadata / watermark" },
    { id: "anatomy", label: "Render artifacts" },
    { id: "voice", label: "Voice / lip-sync" },
    { id: "phrasing", label: "LLM phrasing" },
    { id: "cadence", label: "Posting cadence" },
    { id: "account", label: "Account history" },
    { id: "facts", label: "Fabricated details" },
    { id: "detector", label: "Detector score" },
    { id: "reverse", label: "Provenance trace" },
    { id: "disclosed", label: "Self-disclosed" },
  ];

  // All network calls go through the background worker: content scripts on
  // strict-CSP sites (x.com, banks, etc.) can't fetch cross-origin directly.
  function relayFetch(url, options) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "flagged-fetch", url, options }, (res) => {
        if (chrome.runtime.lastError || !res) reject(new Error("relay unavailable"));
        else resolve(res);
      });
    });
  }

  async function api(path, opts = {}) {
    const key = await identity();
    const res = await relayFetch(API + path, {
      ...opts,
      headers: { "content-type": "application/json", "x-flagged-key": key, ...(opts.headers || {}) },
    });
    let data = {};
    try { data = JSON.parse(res.body || "{}"); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.error || "request failed"), { status: res.status, data });
    return data;
  }

  // ---- local fallback store ----
  async function localAll() {
    const r = await chrome.storage.local.get(LOCAL_KEY);
    return r[LOCAL_KEY] || [];
  }
  async function localSave(flags) { await chrome.storage.local.set({ [LOCAL_KEY]: flags }); }

  // ---- public interface (same four functions as v0.1) ----

  async function getFlagsForUrl(rawUrl) {
    const norm = normalizeUrl(rawUrl);
    try {
      // privacy-preserving: send only the 8-char hash prefix, match locally
      const hash = await sha256hex(norm);
      const { flags } = await api("/v1/lookup/" + hash.slice(0, 8));
      return flags.filter((f) => f.url_hash === hash);
    } catch {
      const flags = await localAll();
      return flags.filter((f) => f.normUrl === norm);
    }
  }

  async function addFlag({ url, type, signals, note }) {
    try {
      const data = await api("/v1/flags", {
        method: "POST",
        body: JSON.stringify({ url, type, signals, note }),
      });
      return { flag: data.flag, duplicate: data.duplicate };
    } catch (e) {
      if (e.status) throw e; // server rejected (budget, validation) — surface it
      // network down: queue locally
      const flags = await localAll();
      const norm = normalizeUrl(url);
      const existing = flags.find((f) => f.normUrl === norm);
      if (existing) return { flag: existing, duplicate: true };
      const flag = {
        id: "local_" + Date.now(), url, normUrl: norm,
        type: type || detectType(url), signals, note: (note || "").slice(0, 280),
        ts: Date.now(), votes: { confirm: 1, dispute: 0 }, offline: true,
      };
      flags.unshift(flag);
      await localSave(flags);
      return { flag, duplicate: false };
    }
  }

  async function voteFlag(id, side) {
    try {
      const data = await api(`/v1/flags/${id}/votes`, {
        method: "POST",
        body: JSON.stringify({ side }),
      });
      const votes = await chrome.storage.local.get(VOTES_KEY);
      const mv = votes[VOTES_KEY] || {}; mv[id] = side;
      await chrome.storage.local.set({ [VOTES_KEY]: mv });
      return { ok: true, flag: data.flag };
    } catch (e) {
      if (e.status === 409) {
        const votes = await chrome.storage.local.get(VOTES_KEY);
        const mv = votes[VOTES_KEY] || {}; if (!mv[id]) { mv[id] = side; await chrome.storage.local.set({ [VOTES_KEY]: mv }); }
        return { ok: false, reason: "already-voted" };
      }
      return { ok: false, reason: e.message };
    }
  }

  async function getMyVote(id) {
    const r = await chrome.storage.local.get(VOTES_KEY);
    return (r[VOTES_KEY] || {})[id] || null;
  }

  async function getRecentFlags(n = 20) {
    try { return (await api(`/v1/flags/recent?n=${n}`)).flags; }
    catch { return (await localAll()).slice(0, n); }
  }

  function statusOf(flag) {
    if (flag.status) return flag.status; // server already computed it
    const total = (flag.votes.confirm || 0) + (flag.votes.dispute || 0);
    if (total < 3) return "unverified";
    const pct = (flag.votes.confirm / total) * 100;
    return pct >= 70 ? "confirmed" : pct <= 40 ? "disputed" : "contested";
  }

  return { API, normalizeUrl, detectType, SIGNALS, getFlagsForUrl, addFlag, voteFlag, getMyVote, getRecentFlags, statusOf, identity };
})();

if (typeof self !== "undefined") self.FlagDB = FlagDB;
