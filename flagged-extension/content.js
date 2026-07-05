// content.js — flagged.ai v0.3
// When scanning is ON, marks AI signatures on the page with bubbles.
// Each bubble names the signature, shows the evidence, and carries the
// community-record actions (flag / confirm / dispute) as a secondary layer.
(function () {
  if (window.top !== window) return;

  const NS = "flaggedai";
  let overlay = null;
  let scanned = false;
  let observer = null;

  // ---------- signature detectors (on-device, evidence-first) ----------

  // Disclosure phrases: platforms and creators labeling AI content.
  const DISCLOSURE_STRONG = /made\s+with\s+@?\s?(grok|imagine)|grok\s*@?\s*imagine|created\s+with\s+@?(dall|midjourney|sora|imagen|firefly|veo)|generated\s+(by|with)\s+@?(chatgpt|claude|gemini|grok|sora|midjourney)|synthid/i;
  const DISCLOSURE_WEAK = /\bai[- ]generated\b(?:\s+([a-z]+))?|\bmade\s+with\s+ai\b|\bgenerated\s+(?:by|with)\s+ai\b/i;
  const MEDIA_NOUNS = new Set(["image","images","imagery","video","videos","photo","photos","picture","pictures","art","artwork","content","audio","voice","music","clip","clips","footage","avatar","portrait","render","animation"]);
  // Returns a matched disclosure string, or null. Bare "AI-generated" only
  // counts when it labels media ("AI-generated image") or stands alone as a
  // short label; "AI-generated domains/names/logos" is product marketing.
  function disclosureIn(t) {
    const strong = t.match(DISCLOSURE_STRONG);
    if (strong) return strong[0];
    const weak = t.match(DISCLOSURE_WEAK);
    if (!weak) return null;
    const next = (weak[1] || "").toLowerCase();
    if (next && !MEDIA_NOUNS.has(next)) return null;
    if (!next && t.length > 80) return null;
    return weak[0];
  }

  // Generator-hosted media: provenance by address.
  const GEN_HOSTS = /(midjourney|civitai|oaiusercontent|openai|replicate\.delivery|leonardo\.ai|ideogram\.ai|imagine\.grok|fal\.media|runwayml)/i;

  // LLM phrasing tells: hints, never proof. Two or more = worth a bubble.
  const TELLS = [
    { re: /\b(delve|delving)\b/i, label: '"delve"' },
    { re: /\b(tapestry|testament to)\b/i, label: '"tapestry / testament to"' },
    { re: /in today's (fast-paced|digital|ever-evolving)/i, label: '"in today\'s fast-paced…"' },
    { re: /it('|’)s (important|worth) (to note|noting)/i, label: '"it\'s important to note"' },
    { re: /\b(seamless(ly)?|leverag(e|ing)|robust|elevate|unlock|game-chang)/i, label: "buzzword cluster" },
    { re: /\b(moreover|furthermore),/i, label: "essay connectives" },
    { re: /not (just|only) [^.!?]{3,40}[,—-]+\s*(it('|’)s|but)/i, label: '"not just X, it\'s Y" construction' },
    { re: /—[^—]{5,60}—/, label: "heavy em-dash cadence" },
    { re: /as an ai\b/i, label: '"as an AI" leak' },
  ];

  const state = () => chrome.storage.local.get(["flagged_on"]).then((r) => r.flagged_on === true);

  // ---------- overlay plumbing ----------
  function ensureOverlay() {
    if (overlay && document.documentElement.contains(overlay)) return overlay;
    overlay = document.createElement("div");
    overlay.id = NS + "-overlay";
    const style = document.createElement("style");
    style.textContent = `
      #${NS}-overlay { position: absolute; top: 0; left: 0; z-index: 2147483646; pointer-events: none; }
      .${NS}-bubble {
        position: absolute; pointer-events: auto; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px;
        background: #fff; border: 1.5px solid #DC2626; color: #B91C1C;
        border-radius: 999px; padding: 3px 9px;
        font: 700 11px/1.35 system-ui, sans-serif; white-space: nowrap;
        box-shadow: 0 3px 12px rgba(23,25,28,.18);
        animation: ${NS}-in .25s ease;
      }
      .${NS}-bubble .dot { width: 6px; height: 6px; border-radius: 50%; background: #DC2626; animation: ${NS}-pulse 2s infinite; }
      @keyframes ${NS}-in { from { transform: scale(.7); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes ${NS}-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      .${NS}-pop {
        position: absolute; pointer-events: auto; width: 270px;
        background: #fff; border: 1px solid #E3E5E0; border-radius: 12px;
        box-shadow: 0 10px 34px rgba(23,25,28,.22); padding: 12px 14px;
        font: 400 12.5px/1.5 system-ui, sans-serif; color: #17191C;
      }
      .${NS}-pop h5 { font: 800 12px/1.3 system-ui; margin: 0 0 6px; color: #B91C1C; }
      .${NS}-pop .sig { display: inline-block; margin: 2px 4px 2px 0; padding: 2px 7px; border-radius: 4px; background: #FEE2E2; color: #B91C1C; font-size: 11px; font-weight: 600; }
      .${NS}-pop .ev { color: #7B8087; font-size: 11.5px; margin-top: 6px; }
      .${NS}-pop .grade { margin-top: 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #7B8087; }
      .${NS}-pop .grade b { color: #17191C; }
      .${NS}-pop .actions { display: flex; gap: 6px; margin-top: 10px; }
      .${NS}-pop button { flex: 1; cursor: pointer; font: 600 11.5px system-ui; border-radius: 999px; padding: 5px 8px; border: 1.5px solid #E3E5E0; background: transparent; color: #17191C; }
      .${NS}-pop button.primary { border-color: #DC2626; background: #DC2626; color: #fff; }
      .${NS}-pop button.warn { border-color: #7B8087; color: #52575C; }
      .${NS}-pop button:disabled { opacity: .45; cursor: default; }
      .${NS}-pop .close { position: absolute; top: 6px; right: 8px; border: none; background: none; color: #7B8087; font-size: 14px; cursor: pointer; flex: none; padding: 2px 4px; }
      @media (prefers-reduced-motion: reduce) { .${NS}-bubble, .${NS}-bubble .dot { animation: none } }
    `;
    overlay.appendChild(style);
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function docPos(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height };
  }

  let sigsThisPage = 0;

  // grade: "hard" (provable), "record" (community), "hint" (heuristic), "llm"
  function bubble(target, title, signals, grade, opts = {}) {
    const ov = ensureOverlay();
    const p = docPos(target);
    if (p.width < 40 && p.height < 20) return;

    const b = document.createElement("button");
    b.className = NS + "-bubble";
    b.style.top = Math.max(2, p.top - 26) + "px";
    b.style.left = Math.max(2, p.left + Math.min(p.width - 60, 8)) + "px";
    const dot = document.createElement("span"); dot.className = "dot";
    b.appendChild(dot);
    b.appendChild(document.createTextNode(title));
    ov.appendChild(b);
    sigsThisPage++;

    let pop = null;
    b.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pop) { pop.remove(); pop = null; return; }
      pop = document.createElement("div");
      pop.className = NS + "-pop";
      pop.style.top = p.top + 16 + "px";
      pop.style.left = Math.max(4, Math.min(p.left, innerWidth - 290 + scrollX)) + "px";

      const h = document.createElement("h5"); h.textContent = title; pop.appendChild(h);
      for (const s of signals) {
        const chip = document.createElement("span"); chip.className = "sig"; chip.textContent = s.label; pop.appendChild(chip);
      }
      const evs = signals.filter((s) => s.evidence).map((s) => s.evidence);
      if (evs.length) { const ev = document.createElement("div"); ev.className = "ev"; ev.textContent = evs.join(" · "); pop.appendChild(ev); }

      const grades = {
        hard: "<b>Provenance signal</b> · provable, from the content itself",
        record: "<b>Community record</b> · settled by crowd votes",
        hint: "<b>Heuristic hint</b> · pattern match, not proof",
        llm: "<b>LLM analysis</b> · model judgment, not proof",
      };
      const g = document.createElement("div"); g.className = "grade"; g.innerHTML = grades[grade] || grades.hint; pop.appendChild(g);

      const actions = document.createElement("div"); actions.className = "actions";

      if (opts.existingFlag) {
        const f = opts.existingFlag;
        const my = await FlagDB.getMyVote(f.id);
        const cBtn = document.createElement("button"); cBtn.className = "primary";
        cBtn.textContent = my === "confirm" ? "✓ Confirmed" : "Confirm AI"; cBtn.disabled = !!my;
        const dBtn = document.createElement("button"); dBtn.className = "warn";
        dBtn.textContent = my === "dispute" ? "✓ Disputed" : "Dispute"; dBtn.disabled = !!my;
        cBtn.onclick = async () => { await FlagDB.voteFlag(f.id, "confirm"); cBtn.textContent = "✓ Confirmed"; cBtn.disabled = dBtn.disabled = true; };
        dBtn.onclick = async () => { await FlagDB.voteFlag(f.id, "dispute"); dBtn.textContent = "✓ Disputed"; cBtn.disabled = dBtn.disabled = true; };
        actions.appendChild(cBtn); actions.appendChild(dBtn);
      } else {
        const fBtn = document.createElement("button"); fBtn.className = "primary";
        fBtn.textContent = "Add to public record";
        fBtn.onclick = async () => {
          fBtn.disabled = true; fBtn.textContent = "Adding…";
          try {
            const note = ("Auto-detected: " + signals.map((s) => s.evidence || s.label).join("; ")).slice(0, 280);
            const r = await FlagDB.addFlag({ url: opts.flagUrl || location.href, signals: signals.map((s) => s.id), note });
            fBtn.textContent = (r.flag && r.flag.offline) ? "Saved locally · ledger unreachable" : "✓ On the record";
          } catch { fBtn.textContent = "Failed, try again"; fBtn.disabled = false; }
        };
        actions.appendChild(fBtn);
      }
      if (opts.reverseUrl) {
        const rBtn = document.createElement("button");
        rBtn.textContent = "Reverse search";
        rBtn.onclick = () => window.open("https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(opts.reverseUrl), "_blank");
        actions.appendChild(rBtn);
      }
      const x = document.createElement("button"); x.className = "close"; x.textContent = "×";
      x.onclick = () => { pop.remove(); pop = null; };
      pop.appendChild(x);
      pop.appendChild(actions);
      ov.appendChild(pop);
    });
  }

  // ---------- scanners ----------
  async function scanLedger() {
    try {
      const flags = await FlagDB.getFlagsForUrl(location.href);
      if (!flags.length) return;
      const f = flags[0];
      const status = FlagDB.statusOf(f);
      if (status === "disputed") return;
      const label = status === "confirmed" ? "AI · confirmed by community" : status === "contested" ? "AI · contested" : "AI · flagged, unverified";
      const sigs = (f.signals || []).map((sid) => {
        const s = FlagDB.SIGNALS.find((x) => x.id === sid);
        return { id: sid, label: s ? s.label : sid, evidence: null };
      });
      if (f.note) sigs[0] = { ...sigs[0], evidence: f.note };
      bubble(document.body, label, sigs, "record", { existingFlag: f });
    } catch {}
  }

  function scanImages() {
    const seen = new Set();
    for (const img of document.querySelectorAll("img, video")) {
      const src = img.currentSrc || img.src || "";
      if (!src || seen.has(src)) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 120 || r.height < 90) continue;
      if (GEN_HOSTS.test(src)) {
        seen.add(src);
        bubble(img, "AI signature: generator source", [
          { id: "reverse", label: "Provenance trace", evidence: "media served from a known AI-generation host" },
        ], "hard", { flagUrl: src.startsWith("http") ? src : location.href, reverseUrl: src });
      }
    }
  }

  const disclosed = new WeakSet();
  function scanDisclosures() {
    let hits = 0;
    // Tweet/post bodies as whole units: X splits "Made with @Grok @Imagine"
    // across mention links, so test the container's combined text.
    for (const el of document.querySelectorAll('[data-testid="tweetText"], [class*=caption], figcaption')) {
      if (hits >= 6) break;
      if (disclosed.has(el)) continue;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      const m = disclosureIn(t);
      if (m && t.length < 600 && el.getClientRects().length) {
        disclosed.add(el); hits++;
        const i = Math.max(0, t.toLowerCase().indexOf(m.toLowerCase()) - 5);
        bubble(el, "AI signature: self-disclosed", [
          { id: "disclosed", label: "Self-disclosed", evidence: '"…' + t.slice(i, i + 70).trim() + '…"' },
        ], "hard");
      }
    }
    // Short standalone labels near media
    for (const el of document.querySelectorAll("span, small, a, [class*=Footer]")) {
      if (hits >= 6) break;
      if (disclosed.has(el) || el.closest('[data-testid="tweetText"]')) continue;
      const t = (el.textContent || "").trim();
      if (t.length > 4 && t.length < 120 && disclosureIn(t) && el.getClientRects().length) {
        disclosed.add(el); hits++;
        bubble(el, "AI signature: self-disclosed", [
          { id: "disclosed", label: "Self-disclosed", evidence: '"' + t.slice(0, 80) + '"' },
        ], "hard");
      }
    }
  }

  function scanText() {
    const blocks = document.querySelectorAll("article p, main p, [class*=post] p, [class*=article] p, [data-testid=tweetText]");
    const scored = new Map(); // container -> {tells:Set, sample}
    for (const p of blocks) {
      const t = p.textContent || "";
      if (t.length < 120) continue;
      const container = p.closest("article, main, [class*=post], [data-testid=tweetText]") || p;
      const entry = scored.get(container) || { tells: new Map(), chars: 0 };
      entry.chars += t.length;
      for (const tell of TELLS) {
        const m = t.match(tell.re);
        if (m) entry.tells.set(tell.label, m[0].slice(0, 50));
      }
      scored.set(container, entry);
    }
    let marked = 0;
    for (const [container, entry] of scored) {
      if (marked >= 3) break;
      if (entry.tells.size >= 2 && entry.chars > 300) {
        marked++;
        const sigs = [...entry.tells.entries()].slice(0, 4).map(([label, sample]) => ({
          id: "phrasing", label, evidence: '"…' + sample + '…"',
        }));
        bubble(container, "Possible AI phrasing (" + entry.tells.size + " tells)", sigs, "hint");
      }
    }
  }

  // ---------- LLM deep scan (via the open API, if the server has it enabled) ----------
  async function deepScan() {
    const main = document.querySelector("article, main") || document.body;
    const text = (main.innerText || "").replace(/\s+/g, " ").slice(0, 6000);
    if (text.length < 300) return { ok: true, found: 0 };
    let res;
    try {
      res = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "flagged-fetch",
          url: (FlagDB.API || "https://flagged-api.vercel.app") + "/v1/analyze",
          options: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) },
        }, (r) => (chrome.runtime.lastError || !r) ? reject(new Error("relay")) : resolve(r));
      });
    } catch { return { ok: false, error: "Can't reach the analysis API" }; }
    if (res.status === 501) return { ok: false, error: "LLM analysis isn't enabled on the server yet" };
    if (!res.ok) return { ok: false, error: "Analysis failed (" + (res.status || "network") + ")" };
    let data = {};
    try { data = JSON.parse(res.body || "{}"); } catch { return { ok: false, error: "Bad analysis response" }; }
    const sigs = (data.signals || []).slice(0, 5).map((s) => ({ id: s.id || "detector", label: s.label || s.id, evidence: s.evidence }));
    if (!sigs.length || (data.likelihood || 0) < 0.5) return { ok: true, found: 0 };
    bubble(document.querySelector("article, main") || document.body,
      "LLM analysis: " + Math.round((data.likelihood || 0) * 100) + "% AI-likely",
      sigs, "llm");
    return { ok: true, found: sigs.length };
  }

  // ---------- lifecycle ----------
  function clearAll() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (observer) { observer.disconnect(); observer = null; }
    scanned = false;
    sigsThisPage = 0;
  }

  let rescanTimer = null;
  let lastCounted = 0;

  async function bumpStats(pages, sigs) {
    if (!pages && !sigs) return;
    const st = await chrome.storage.local.get("flagged_stats");
    const stats = st.flagged_stats || { pages: 0, sigs: 0 };
    stats.pages += pages; stats.sigs += sigs;
    await chrome.storage.local.set({ flagged_stats: stats });
  }

  async function rescan() {
    if (!(await state())) return;
    const before = sigsThisPage;
    scanImages(); scanDisclosures(); scanText();
    await bumpStats(0, sigsThisPage - before);
  }

  async function scan() {
    if (!(await state())) return;
    clearAll();
    ensureOverlay();
    sigsThisPage = 0;
    await scanLedger();
    scanImages();
    scanDisclosures();
    scanText();
    scanned = true;
    await bumpStats(1, sigsThisPage);
    // SPA content often lands after document_idle: sweep again shortly
    setTimeout(rescan, 1200);
    setTimeout(rescan, 3500);
    setTimeout(rescan, 8000);
    // throttled rescan on DOM changes: guaranteed to fire even when the page
    // mutates continuously (X updates timestamps and counters nonstop)
    observer = new MutationObserver(() => {
      if (rescanTimer) return;
      rescanTimer = setTimeout(() => { rescanTimer = null; rescan(); }, 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // X and most modern sites navigate without page loads: rescan on url change
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      state().then((on) => on && scan());
    }
  }, 1000);

  async function analyzeImage(srcUrl) {
    const clean = srcUrl.split("?")[0];
    const img = [...document.querySelectorAll("img")].find((i) => {
      const s2 = i.currentSrc || i.src || "";
      return s2 === srcUrl || s2.split("?")[0] === clean;
    }) || document.body;

    const sigs = [];
    let grade = "llm";
    let title = null;

    // metadata forensics first: free and provable when it hits
    try {
      const sniff = await new Promise((resolve) =>
        chrome.runtime.sendMessage({ type: "flagged-sniff", url: srcUrl }, (r) => resolve(r || { markers: [] })));
      if (sniff.markers && sniff.markers.length) {
        grade = "hard";
        title = "AI signature: provenance metadata";
        for (const m of sniff.markers.slice(0, 3)) {
          sigs.push({ id: "metadata", label: "Metadata marker", evidence: '"' + m + '" found in image bytes' });
        }
      }
    } catch {}

    // vision model
    try {
      const res = await new Promise((resolve, reject) =>
        chrome.runtime.sendMessage({
          type: "flagged-fetch",
          url: (FlagDB.API || "https://flagged-api.vercel.app") + "/v1/analyze-image",
          options: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image_url: srcUrl }) },
        }, (r) => (chrome.runtime.lastError || !r) ? reject(new Error("relay")) : resolve(r)));
      if (res.ok) {
        const data = JSON.parse(res.body || "{}");
        const cats = { ai_generated: "AI-generated", ai_edited: "AI-edited (real photo, altered)", likely_real: "no artifacts found", unclear: "inconclusive" };
        if (!title) title = "Image analysis: " + (cats[data.category] || "inconclusive") +
          (data.likelihood >= 0.5 ? " · " + Math.round(data.likelihood * 100) + "%" : "");
        for (const sg of (data.signals || []).slice(0, 4)) {
          sigs.push({ id: sg.id || "detector", label: sg.label || "Visual artifact", evidence: sg.evidence });
        }
        if (!sigs.length) sigs.push({ id: "detector", label: cats[data.category] || "Inconclusive", evidence: "no visible generation or manipulation artifacts" });
      } else {
        const errBody = (() => { try { return JSON.parse(res.body || "{}").error; } catch { return null; } })();
        if (!sigs.length) { title = "Image analysis unavailable"; sigs.push({ id: "detector", label: "Not analyzed", evidence: errBody || "server declined (" + res.status + ")" }); }
      }
    } catch {
      if (!sigs.length) { title = "Image analysis unavailable"; sigs.push({ id: "detector", label: "Not analyzed", evidence: "could not reach the analysis API" }); }
    }

    bubble(img, title || "Image analysis", sigs, grade, {
      flagUrl: srcUrl.startsWith("http") ? srcUrl : location.href,
      reverseUrl: srcUrl,
    });
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (!msg) return;
    if (msg.type === "flagged-scan") { scan(); }
    if (msg.type === "flagged-analyze-image") { ensureOverlay(); analyzeImage(msg.srcUrl); }
    if (msg.type === "flagged-clear") { clearAll(); }
    if (msg.type === "flagged-refresh") { state().then((on) => on && scan()); }
    if (msg.type === "flagged-deepscan") {
      deepScan().then(sendResponse);
      return true; // async response
    }
  });

  state().then((on) => { if (on) scan(); });
})();
