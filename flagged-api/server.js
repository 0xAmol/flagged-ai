// server.js — the flagged.ai open ledger API (v0)
// Permissionless: no signup, no API keys to request. Identity is a
// self-generated key; reputation and rate limits do the policing.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";

const DB_PATH = process.env.DB_PATH || "./flagged.db";
const PORT = Number(process.env.PORT || 8787);
const db = new DatabaseSync(DB_PATH);

// ---------- schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS flags (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    norm_url TEXT NOT NULL,
    url_hash TEXT NOT NULL,
    type TEXT NOT NULL,
    signals TEXT NOT NULL,          -- JSON array
    note TEXT DEFAULT '',
    submitter_kind TEXT NOT NULL,   -- 'human' | 'agent'
    submitter_key TEXT NOT NULL,
    agent_name TEXT,
    ts INTEGER NOT NULL,
    confirm INTEGER DEFAULT 1,
    dispute INTEGER DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_norm ON flags(norm_url);
  CREATE INDEX IF NOT EXISTS idx_hash ON flags(url_hash);
  CREATE TABLE IF NOT EXISTS votes (
    flag_id TEXT NOT NULL,
    voter_key TEXT NOT NULL,
    side TEXT NOT NULL,             -- 'confirm' | 'dispute'
    ts INTEGER NOT NULL,
    UNIQUE(flag_id, voter_key)
  );
  CREATE TABLE IF NOT EXISTS submitters (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT,
    flags_total INTEGER DEFAULT 0,
    flags_confirmed INTEGER DEFAULT 0,
    flags_disputed INTEGER DEFAULT 0,
    created_ts INTEGER NOT NULL
  );
`);

// ---------- domain logic ----------
const SIGNALS = new Set([
  "metadata", "anatomy", "voice", "phrasing", "cadence",
  "account", "facts", "detector", "reverse", "disclosed",
]);
const TYPES = new Set(["tweet", "image", "video", "article", "website", "newsletter", "text"]);
const STRIP_PARAMS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","ref","s","t","si","igsh"];

function normalizeUrl(raw) {
  const u = new URL(raw); // throws on garbage — caught by caller
  if (!/^https?:$/.test(u.protocol)) throw new Error("http(s) only");
  const params = new URLSearchParams(u.search);
  STRIP_PARAMS.forEach((p) => params.delete(p));
  const q = params.toString();
  return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + (q ? "?" + q : "")).toLowerCase();
}
const hashOf = (norm) => createHash("sha256").update(norm).digest("hex");

function statusOf(f) {
  const total = f.confirm + f.dispute;
  if (total < 3) return "unverified";
  const pct = (f.confirm / total) * 100;
  return pct >= 70 ? "confirmed" : pct <= 40 ? "disputed" : "contested";
}

// Reputation: Laplace-smoothed confirm rate. New submitters start at 0.5.
function reputation(s) {
  return (s.flags_confirmed + 1) / (s.flags_confirmed + s.flags_disputed + 2);
}
// Daily flag budget scales with reputation. Everyone gets in the door;
// trusted submitters get scale. rep 0.5 -> 20/day, 0.9 -> 100/day, <0.2 -> 2/day.
function dailyBudget(rep) {
  if (rep < 0.2) return 2;
  return Math.round(10 + rep * 100);
}

function serializeFlag(f) {
  return {
    id: f.id, url: f.url, url_hash: f.url_hash, type: f.type,
    signals: JSON.parse(f.signals), note: f.note,
    submitter: { kind: f.submitter_kind, name: f.agent_name || null },
    ts: f.ts, votes: { confirm: f.confirm, dispute: f.dispute },
    status: statusOf(f),
  };
}

function refreshSubmitterStats(key) {
  const rows = db.prepare("SELECT confirm, dispute FROM flags WHERE submitter_key = ?").all(key);
  let confirmed = 0, disputed = 0;
  for (const r of rows) {
    const st = statusOf(r);
    if (st === "confirmed") confirmed++;
    if (st === "disputed") disputed++;
  }
  db.prepare("UPDATE submitters SET flags_total=?, flags_confirmed=?, flags_disputed=? WHERE key=?")
    .run(rows.length, confirmed, disputed, key);
}

// ---------- rate limiting (in-memory sliding windows) ----------
const buckets = new Map();
function limited(bucketKey, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(bucketKey) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(bucketKey, arr); return true; }
  arr.push(now);
  buckets.set(bucketKey, arr);
  return false;
}
setInterval(() => { if (buckets.size > 50000) buckets.clear(); }, 600000).unref();

// ---------- api ----------
const app = new Hono();
app.use("*", cors());
const err = (c, code, msg) => c.json({ error: msg }, code);
const clientKey = (c) =>
  (c.req.header("x-flagged-key") || "").slice(0, 64) ||
  "ip:" + (c.req.header("x-forwarded-for") || "anon").split(",")[0].trim();

app.get("/v1/health", (c) => c.json({ ok: true, service: "flagged.ai ledger", version: "0.1.0" }));

// --- k-anonymous lookup: client sends first 8 hex chars of sha256(normalized url),
// gets every flag whose hash shares the prefix, matches the full hash locally.
// The server never learns which exact URL was visited.
app.get("/v1/lookup/:prefix", (c) => {
  const prefix = c.req.param("prefix").toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(prefix)) return err(c, 400, "prefix must be 8 hex chars");
  if (limited("lu:" + clientKey(c), 300, 60000)) return err(c, 429, "rate limited");
  const rows = db.prepare("SELECT * FROM flags WHERE url_hash LIKE ? LIMIT 50").all(prefix + "%");
  return c.json({ prefix, flags: rows.map(serializeFlag) });
});

// --- direct lookup by URL (for the website; less private than /lookup)
app.get("/v1/flags", (c) => {
  const url = c.req.query("url");
  if (!url) return err(c, 400, "url query param required");
  let norm;
  try { norm = normalizeUrl(url); } catch { return err(c, 400, "invalid url"); }
  const rows = db.prepare("SELECT * FROM flags WHERE norm_url = ?").all(norm);
  return c.json({ flags: rows.map(serializeFlag) });
});

app.get("/v1/flags/recent", (c) => {
  const n = Math.min(Number(c.req.query("n") || 50), 200);
  const type = c.req.query("type");
  const rows = type && TYPES.has(type)
    ? db.prepare("SELECT * FROM flags WHERE type=? ORDER BY ts DESC LIMIT ?").all(type, n)
    : db.prepare("SELECT * FROM flags ORDER BY ts DESC LIMIT ?").all(n);
  return c.json({ flags: rows.map(serializeFlag) });
});

// --- submit a flag. Permissionless: any key works, budget scales with reputation.
app.post("/v1/flags", async (c) => {
  const key = clientKey(c);
  if (limited("fl-burst:" + key, 10, 60000)) return err(c, 429, "slow down");

  let body;
  try { body = await c.req.json(); } catch { return err(c, 400, "json body required"); }
  const { url, type, signals, note, submitter } = body || {};

  let norm;
  try { norm = normalizeUrl(String(url || "")); } catch { return err(c, 400, "invalid url"); }
  if (!Array.isArray(signals) || signals.length === 0) return err(c, 400, "signals[] required — flags need evidence");
  if (!signals.every((s) => SIGNALS.has(s))) return err(c, 400, "unknown signal id");
  const kind = submitter?.kind === "agent" ? "agent" : "human";
  const flagType = TYPES.has(type) ? type : "website";

  // reputation-scaled daily budget
  const now = Date.now();
  let sub = db.prepare("SELECT * FROM submitters WHERE key=?").get(key);
  if (!sub) {
    db.prepare("INSERT INTO submitters (key, kind, name, created_ts) VALUES (?,?,?,?)")
      .run(key, kind, submitter?.name || null, now);
    sub = db.prepare("SELECT * FROM submitters WHERE key=?").get(key);
  }
  const rep = reputation(sub);
  const today = db.prepare("SELECT COUNT(*) AS n FROM flags WHERE submitter_key=? AND ts > ?")
    .get(key, now - 86400000).n;
  if (today >= dailyBudget(rep)) {
    return err(c, 429, `daily flag budget reached (${dailyBudget(rep)} at reputation ${rep.toFixed(2)}) — confirmed flags raise your budget`);
  }

  const existing = db.prepare("SELECT * FROM flags WHERE norm_url=?").get(norm);
  if (existing) return c.json({ flag: serializeFlag(existing), duplicate: true }, 200);

  const flag = {
    id: "f_" + randomUUID().slice(0, 12),
    url: String(url).slice(0, 2000), norm_url: norm, url_hash: hashOf(norm),
    type: flagType, signals: JSON.stringify(signals.slice(0, 10)),
    note: String(note || "").slice(0, 280),
    submitter_kind: kind, submitter_key: key,
    agent_name: kind === "agent" ? String(submitter?.name || "unnamed-agent").slice(0, 32) : null,
    ts: now, confirm: 1, dispute: 0,
  };
  db.prepare(`INSERT INTO flags (id,url,norm_url,url_hash,type,signals,note,submitter_kind,submitter_key,agent_name,ts,confirm,dispute)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(flag.id, flag.url, flag.norm_url, flag.url_hash, flag.type, flag.signals, flag.note,
         flag.submitter_kind, flag.submitter_key, flag.agent_name, flag.ts, 1, 0);
  db.prepare("INSERT INTO votes (flag_id, voter_key, side, ts) VALUES (?,?,?,?)").run(flag.id, key, "confirm", now);
  refreshSubmitterStats(key);
  return c.json({ flag: serializeFlag(flag), duplicate: false }, 201);
});

// --- vote on a flag: one vote per key per flag, submitter can't double-dip.
app.post("/v1/flags/:id/votes", async (c) => {
  const key = clientKey(c);
  if (limited("vt:" + key, 60, 60000)) return err(c, 429, "slow down");
  let body;
  try { body = await c.req.json(); } catch { return err(c, 400, "json body required"); }
  const side = body?.side;
  if (side !== "confirm" && side !== "dispute") return err(c, 400, "side must be confirm or dispute");
  const flag = db.prepare("SELECT * FROM flags WHERE id=?").get(c.req.param("id"));
  if (!flag) return err(c, 404, "flag not found");
  try {
    db.prepare("INSERT INTO votes (flag_id, voter_key, side, ts) VALUES (?,?,?,?)")
      .run(flag.id, key, side, Date.now());
  } catch {
    return err(c, 409, "already voted on this flag");
  }
  db.prepare(`UPDATE flags SET ${side} = ${side} + 1 WHERE id=?`).run(flag.id);
  refreshSubmitterStats(flag.submitter_key);
  const updated = db.prepare("SELECT * FROM flags WHERE id=?").get(flag.id);
  return c.json({ flag: serializeFlag(updated) });
});

// --- public reputation for any submitter key (agents can advertise theirs)
app.get("/v1/submitters/:key", (c) => {
  const sub = db.prepare("SELECT * FROM submitters WHERE key=?").get(c.req.param("key").slice(0, 64));
  if (!sub) return err(c, 404, "unknown submitter");
  return c.json({
    key: sub.key, kind: sub.kind, name: sub.name,
    flags: { total: sub.flags_total, confirmed: sub.flags_confirmed, disputed: sub.flags_disputed },
    reputation: Number(reputation(sub).toFixed(3)),
    daily_budget: dailyBudget(reputation(sub)),
  });
});

app.get("/v1/stats", (c) => {
  const total = db.prepare("SELECT COUNT(*) n FROM flags").get().n;
  const agents = db.prepare("SELECT COUNT(*) n FROM flags WHERE submitter_kind='agent'").get().n;
  const votes = db.prepare("SELECT COUNT(*) n FROM votes").get().n;
  return c.json({ flags: total, agent_flags: agents, votes });
});

serve({ fetch: app.fetch, port: PORT }, () =>
  console.log(`flagged.ai ledger listening on :${PORT} (db: ${DB_PATH})`)
);
