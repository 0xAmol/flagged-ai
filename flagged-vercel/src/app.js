// src/app.js — flagged.ai open ledger, Postgres edition (Supabase + Vercel).
// Same permissionless model as v0.1: self-generated keys, reputation-scaled
// budgets, crowd lifecycle. SQLite swapped for Postgres; burst limits moved
// into the database because serverless instances don't share memory.
import { Hono } from "hono";
import { cors } from "hono/cors";
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";

// prepare:false is required for Supabase's transaction pooler (port 6543)
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

// ---------- domain ----------
const SIGNALS = new Set(["metadata","anatomy","voice","phrasing","cadence","account","facts","detector","reverse","disclosed"]);
const TYPES = new Set(["tweet","image","video","article","website","newsletter","text"]);
const STRIP = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","ref","s","t","si","igsh"];

function normalizeUrl(raw) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("http(s) only");
  const params = new URLSearchParams(u.search);
  STRIP.forEach((p) => params.delete(p));
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
const reputation = (s) => (s.flags_confirmed + 1) / (s.flags_confirmed + s.flags_disputed + 2);
const dailyBudget = (rep) => (rep < 0.2 ? 2 : Math.round(10 + rep * 100));

function serializeFlag(f) {
  return {
    id: f.id, url: f.url, url_hash: f.url_hash, type: f.type,
    signals: typeof f.signals === "string" ? JSON.parse(f.signals) : f.signals,
    note: f.note,
    submitter: { kind: f.submitter_kind, name: f.agent_name || null },
    ts: Number(f.ts), votes: { confirm: f.confirm, dispute: f.dispute },
    status: statusOf(f),
  };
}

async function refreshSubmitterStats(key) {
  const rows = await sql`select confirm, dispute from flags where submitter_key = ${key}`;
  let confirmed = 0, disputed = 0;
  for (const r of rows) {
    const st = statusOf(r);
    if (st === "confirmed") confirmed++;
    if (st === "disputed") disputed++;
  }
  await sql`update submitters set flags_total=${rows.length}, flags_confirmed=${confirmed}, flags_disputed=${disputed} where key=${key}`;
}

// ---------- api ----------
export const app = new Hono().basePath("/");
app.use("*", cors());
const err = (c, code, msg) => c.json({ error: msg }, code);
const clientKey = (c) =>
  (c.req.header("x-flagged-key") || "").slice(0, 64) ||
  "ip:" + (c.req.header("x-forwarded-for") || "anon").split(",")[0].trim();

app.get("/v1/health", async (c) => {
  await sql`select 1`;
  return c.json({ ok: true, service: "flagged.ai ledger", version: "0.2.0", db: "postgres" });
});

// k-anonymous lookup: 8-hex-char prefix in, candidates out, matching on-device.
app.get("/v1/lookup/:prefix", async (c) => {
  const prefix = c.req.param("prefix").toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(prefix)) return err(c, 400, "prefix must be 8 hex chars");
  const rows = await sql`select * from flags where url_hash like ${prefix + "%"} limit 50`;
  c.header("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return c.json({ prefix, flags: rows.map(serializeFlag) });
});

app.get("/v1/flags", async (c) => {
  const url = c.req.query("url");
  if (!url) return err(c, 400, "url query param required");
  let norm;
  try { norm = normalizeUrl(url); } catch { return err(c, 400, "invalid url"); }
  const rows = await sql`select * from flags where norm_url = ${norm}`;
  return c.json({ flags: rows.map(serializeFlag) });
});

app.get("/v1/flags/recent", async (c) => {
  const n = Math.min(Number(c.req.query("n") || 50), 200);
  const type = c.req.query("type");
  const rows = type && TYPES.has(type)
    ? await sql`select * from flags where type=${type} order by ts desc limit ${n}`
    : await sql`select * from flags order by ts desc limit ${n}`;
  return c.json({ flags: rows.map(serializeFlag) });
});

app.post("/v1/flags", async (c) => {
  const key = clientKey(c);
  const now = Date.now();

  let body;
  try { body = await c.req.json(); } catch { return err(c, 400, "json body required"); }
  const { url, type, signals, note, submitter } = body || {};

  let norm;
  try { norm = normalizeUrl(String(url || "")); } catch { return err(c, 400, "invalid url"); }
  if (!Array.isArray(signals) || signals.length === 0) return err(c, 400, "signals[] required — flags need evidence");
  if (!signals.every((s) => SIGNALS.has(s))) return err(c, 400, "unknown signal id");
  const kind = submitter?.kind === "agent" ? "agent" : "human";
  const flagType = TYPES.has(type) ? type : "website";

  // burst limit, DB-backed (serverless-safe): max 10 flags/min per key
  const [{ n: lastMin }] = await sql`select count(*)::int n from flags where submitter_key=${key} and ts > ${now - 60000}`;
  if (lastMin >= 10) return err(c, 429, "slow down");

  // ensure submitter row, then reputation-scaled daily budget
  await sql`insert into submitters (key, kind, name, created_ts) values (${key}, ${kind}, ${submitter?.name || null}, ${now}) on conflict (key) do nothing`;
  const [sub] = await sql`select * from submitters where key=${key}`;
  const rep = reputation(sub);
  const [{ n: today }] = await sql`select count(*)::int n from flags where submitter_key=${key} and ts > ${now - 86400000}`;
  if (today >= dailyBudget(rep)) {
    return err(c, 429, `daily flag budget reached (${dailyBudget(rep)} at reputation ${rep.toFixed(2)}) — confirmed flags raise your budget`);
  }

  const flag = {
    id: "f_" + randomUUID().slice(0, 12),
    url: String(url).slice(0, 2000), norm_url: norm, url_hash: hashOf(norm),
    type: flagType, signals: JSON.stringify(signals.slice(0, 10)),
    note: String(note || "").slice(0, 280),
    submitter_kind: kind, submitter_key: key,
    agent_name: kind === "agent" ? String(submitter?.name || "unnamed-agent").slice(0, 32) : null,
    ts: now,
  };

  // dedupe atomically on norm_url
  const inserted = await sql`
    insert into flags (id,url,norm_url,url_hash,type,signals,note,submitter_kind,submitter_key,agent_name,ts,confirm,dispute)
    values (${flag.id},${flag.url},${flag.norm_url},${flag.url_hash},${flag.type},${flag.signals},${flag.note},${flag.submitter_kind},${flag.submitter_key},${flag.agent_name},${flag.ts},1,0)
    on conflict (norm_url) do nothing
    returning *`;
  if (inserted.length === 0) {
    const [existing] = await sql`select * from flags where norm_url=${norm}`;
    return c.json({ flag: serializeFlag(existing), duplicate: true }, 200);
  }
  await sql`insert into votes (flag_id, voter_key, side, ts) values (${flag.id}, ${key}, 'confirm', ${now}) on conflict do nothing`;
  await refreshSubmitterStats(key);
  return c.json({ flag: serializeFlag(inserted[0]), duplicate: false }, 201);
});

app.post("/v1/flags/:id/votes", async (c) => {
  const key = clientKey(c);
  const now = Date.now();
  let body;
  try { body = await c.req.json(); } catch { return err(c, 400, "json body required"); }
  const side = body?.side;
  if (side !== "confirm" && side !== "dispute") return err(c, 400, "side must be confirm or dispute");

  // burst limit: 60 votes/min per key, DB-backed
  const [{ n: lastMin }] = await sql`select count(*)::int n from votes where voter_key=${key} and ts > ${now - 60000}`;
  if (lastMin >= 60) return err(c, 429, "slow down");

  const id = c.req.param("id");
  const [flag] = await sql`select * from flags where id=${id}`;
  if (!flag) return err(c, 404, "flag not found");

  const voted = await sql`insert into votes (flag_id, voter_key, side, ts) values (${id}, ${key}, ${side}, ${now}) on conflict do nothing returning *`;
  if (voted.length === 0) return err(c, 409, "already voted on this flag");

  const [updated] = side === "confirm"
    ? await sql`update flags set confirm = confirm + 1 where id=${id} returning *`
    : await sql`update flags set dispute = dispute + 1 where id=${id} returning *`;
  await refreshSubmitterStats(flag.submitter_key);
  return c.json({ flag: serializeFlag(updated) });
});

app.get("/v1/submitters/:key", async (c) => {
  const [sub] = await sql`select * from submitters where key=${c.req.param("key").slice(0, 64)}`;
  if (!sub) return err(c, 404, "unknown submitter");
  return c.json({
    key: sub.key, kind: sub.kind, name: sub.name,
    flags: { total: sub.flags_total, confirmed: sub.flags_confirmed, disputed: sub.flags_disputed },
    reputation: Number(reputation(sub).toFixed(3)),
    daily_budget: dailyBudget(reputation(sub)),
  });
});


// LLM signature analysis. Permissionless like everything else, but it costs
// the operator real money per call, so it only turns on when the server has
// an ANTHROPIC_API_KEY, and it's capped per key and globally per day.
app.post("/v1/analyze", async (c) => {
  if (!process.env.ANTHROPIC_API_KEY) return err(c, 501, "LLM analysis not enabled on this server");
  const key = clientKey(c);
  const now = Date.now();
  await sql`create table if not exists analyze_log (key text not null, ts bigint not null)`;
  const [{ n: mine }] = await sql`select count(*)::int n from analyze_log where key=${key} and ts > ${now - 86400000}`;
  if (mine >= Number(process.env.ANALYZE_DAILY_PER_KEY || 50)) return err(c, 429, "daily analysis budget reached for this key");
  const [{ n: all }] = await sql`select count(*)::int n from analyze_log where ts > ${now - 86400000}`;
  if (all >= Number(process.env.ANALYZE_DAILY_GLOBAL || 1000)) return err(c, 429, "global daily analysis budget reached");

  let body;
  try { body = await c.req.json(); } catch { return err(c, 400, "json body required"); }
  const text = String(body?.text || "").slice(0, 6000);
  if (text.length < 200) return err(c, 400, "text too short to analyze (min 200 chars)");

  const prompt = `You analyze text for signatures of AI generation. Respond with ONLY a JSON object, no markdown, in this exact shape:
{"likelihood": <0..1>, "signals": [{"id": "phrasing|facts|detector", "label": "<short signature name>", "evidence": "<short quote or observation from the text>"}]}
Rules: likelihood is your honest estimate that this text is substantially AI-generated. Include at most 5 signals, each grounded in the actual text. If the text seems human-written, return likelihood below 0.5 and an empty signals array. Never invent evidence.

TEXT:
${text}`;

  let out;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANALYZE_MODEL || "claude-haiku-4-5",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return err(c, 502, "analysis model error");
    const raw = (data.content || []).map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
    out = JSON.parse(raw);
  } catch {
    return err(c, 502, "analysis failed");
  }
  await sql`insert into analyze_log (key, ts) values (${key}, ${now})`;
  return c.json({
    likelihood: Math.max(0, Math.min(1, Number(out.likelihood) || 0)),
    signals: Array.isArray(out.signals) ? out.signals.slice(0, 5) : [],
    note: "model judgment, not proof",
  });
});


// Vision analysis: fetch an image and ask the model to examine it for
// generation/manipulation artifacts. Same permissionless caps as /v1/analyze.
app.post("/v1/analyze-image", async (c) => {
  if (!process.env.ANTHROPIC_API_KEY) return err(c, 501, "LLM analysis not enabled on this server");
  const key = clientKey(c);
  const now = Date.now();
  await sql`create table if not exists analyze_log (key text not null, ts bigint not null)`;
  const [{ n: mine }] = await sql`select count(*)::int n from analyze_log where key=${key} and ts > ${now - 86400000}`;
  if (mine >= Number(process.env.ANALYZE_DAILY_PER_KEY || 50)) return err(c, 429, "daily analysis budget reached for this key");
  const [{ n: all }] = await sql`select count(*)::int n from analyze_log where ts > ${now - 86400000}`;
  if (all >= Number(process.env.ANALYZE_DAILY_GLOBAL || 1000)) return err(c, 429, "global daily analysis budget reached");

  let body;
  try { body = await c.req.json(); } catch { return err(c, 400, "json body required"); }
  let imgUrl;
  try {
    imgUrl = new URL(String(body?.image_url || ""));
    if (!/^https?:$/.test(imgUrl.protocol)) throw 0;
  } catch { return err(c, 400, "valid image_url required"); }

  let mediaType, b64;
  try {
    const r = await fetch(imgUrl.href, { headers: { accept: "image/*" } });
    mediaType = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) return err(c, 415, "unsupported image type: " + mediaType);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4_500_000) return err(c, 413, "image too large (4.5MB max)");
    b64 = buf.toString("base64");
  } catch { return err(c, 502, "could not fetch that image"); }

  const prompt = `You are examining an image for signs of AI generation or AI manipulation. Look for: lighting and shadow direction consistency across the scene; blending or halo artifacts around objects (signs of insertion or replacement); rendering of any text, logos, or flags; anatomy and hands; texture repetition or over-smoothness; physically implausible details; compression inconsistencies between regions.
Respond with ONLY a JSON object, no markdown:
{"likelihood": <0..1 that this image is AI-generated or AI-edited>, "category": "ai_generated" | "ai_edited" | "likely_real" | "unclear", "signals": [{"id": "anatomy", "label": "<short name>", "evidence": "<the specific visible detail>"}]}
Rules: at most 5 signals, each tied to something actually visible. If regions differ (a real photo with one edited element), say which element and use category ai_edited. If you see no artifacts, likelihood below 0.5, empty signals, category likely_real or unclear. Never invent details.`;

  let out;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANALYZE_MODEL || "claude-haiku-4-5",
        max_tokens: 600,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: prompt },
        ]}],
      }),
    });
    const data = await r.json();
    if (!r.ok) return err(c, 502, "analysis model error");
    const raw = (data.content || []).map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
    out = JSON.parse(raw);
  } catch { return err(c, 502, "analysis failed"); }
  await sql`insert into analyze_log (key, ts) values (${key}, ${now})`;
  return c.json({
    likelihood: Math.max(0, Math.min(1, Number(out.likelihood) || 0)),
    category: ["ai_generated","ai_edited","likely_real","unclear"].includes(out.category) ? out.category : "unclear",
    signals: Array.isArray(out.signals) ? out.signals.slice(0, 5) : [],
    note: "model judgment, not proof",
  });
});

app.get("/v1/stats", async (c) => {
  const [f] = await sql`select count(*)::int n, count(*) filter (where submitter_kind='agent')::int a from flags`;
  const [v] = await sql`select count(*)::int n from votes`;
  c.header("Cache-Control", "public, s-maxage=30");
  return c.json({ flags: f.n, agent_flags: f.a, votes: v.n });
});

export default app;
