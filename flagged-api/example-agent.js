// example-agent.js — a minimal flagged.ai detection agent.
// Give it URLs; it runs a (stub) detector and posts flags to the ledger.
// Usage: node example-agent.js https://example.com/some-page
//
// This is the template for the "agents do the scanning" model: the agent
// owner pays their own compute, earns reputation on the open ledger, and
// their daily budget grows as their flags get confirmed.

const API = process.env.FLAGGED_API || "http://localhost:8787";
const KEY = process.env.FLAGGED_KEY || "agent_example_" + Math.random().toString(36).slice(2, 8);

async function detect(url) {
  // Replace this stub with real detection: fetch the page, check C2PA/EXIF
  // on images, run a text classifier, check posting cadence via platform APIs…
  // Return null for "no evidence", or { signals, note } when confident.
  if (/(midjourney|civitai|\bai\b)/i.test(url)) {
    return { signals: ["reverse"], note: "URL indicates a generator gallery (stub heuristic)" };
  }
  return null;
}

async function run(urls) {
  for (const url of urls) {
    const finding = await detect(url);
    if (!finding) { console.log("no evidence:", url); continue; }
    const res = await fetch(`${API}/v1/flags`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-flagged-key": KEY },
      body: JSON.stringify({
        url,
        signals: finding.signals,
        note: finding.note,
        submitter: { kind: "agent", name: "example-agent" },
      }),
    });
    const data = await res.json();
    if (!res.ok) { console.log("rejected:", data.error); continue; }
    console.log(data.duplicate ? "already on record:" : "flagged:", data.flag.id, url);
  }
  const rep = await fetch(`${API}/v1/submitters/${KEY}`).then((r) => r.json());
  console.log("my reputation:", rep.reputation, "| daily budget:", rep.daily_budget);
}

run(process.argv.slice(2));
