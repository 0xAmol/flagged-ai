// content.js — Artifake v0.6
// When scanning is ON, marks AI signatures on the page with bubbles.
// v0.6: verdict-themed cards (red only when something IS detected), instant
// loading states, hover-to-scan badge on images, numbered anchor markers
// painted on analyzed images (from the API's normalized anchors), honest
// completion toasts. Every existing v0.3 behavior is preserved.
(function () {
  if (window.top !== window) return;

  const NS = "flaggedai";
  let overlay = null;
  let scanned = false;
  let observer = null;

  // ---------- signature detectors (on-device, evidence-first) ----------

  const DISCLOSURE_STRONG = /made\s+with\s+@?\s?(grok|imagine)|grok\s*@?\s*imagine|created\s+with\s+@?(dall|midjourney|sora|imagen|firefly|veo)|generated\s+(by|with)\s+@?(chatgpt|claude|gemini|grok|sora|midjourney)|synthid/i;
  const DISCLOSURE_WEAK = /\bai[- ]generated\b(?:\s+([a-z]+))?|\bmade\s+with\s+ai\b|\bgenerated\s+(?:by|with)\s+ai\b/i;
  const MEDIA_NOUNS = new Set(["image","images","imagery","video","videos","photo","photos","picture","pictures","art","artwork","content","audio","voice","music","clip","clips","footage","avatar","portrait","render","animation"]);
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

  const GEN_HOSTS = /(midjourney|civitai|oaiusercontent|openai|replicate\.delivery|leonardo\.ai|ideogram\.ai|imagine\.grok|fal\.media|runwayml)/i;

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

  const state = () => chrome.storage.local.get(["flagged_on"]).then((r) => r.flagged_on === true).catch(() => false);

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
      /* v0.6 verdict themes: red is EARNED, not default */
      .${NS}-bubble.${NS}-real { border-color: #3E9B4F; color: #2F7A3D; }
      .${NS}-bubble.${NS}-real .dot { background: #3E9B4F; animation: none; }
      .${NS}-bubble.${NS}-unclear { border-color: #9AA0A6; color: #52575C; }
      .${NS}-bubble.${NS}-unclear .dot { background: #9AA0A6; animation: none; }
      .${NS}-bubble.${NS}-info { border-color: #9AA0A6; color: #52575C; }
      .${NS}-bubble.${NS}-info .dot { background: #9AA0A6; }
      .${NS}-spin { width: 10px; height: 10px; border: 2px solid #D5D7D4; border-top-color: #52575C; border-radius: 50%; animation: ${NS}-rot .8s linear infinite; flex: none; }
      @keyframes ${NS}-rot { to { transform: rotate(360deg) } }
      @keyframes ${NS}-in { from { transform: scale(.7); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes ${NS}-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      .${NS}-pop {
        position: absolute; pointer-events: auto; width: 270px;
        background: #fff; border: 1px solid #E3E5E0; border-radius: 12px;
        box-shadow: 0 10px 34px rgba(23,25,28,.22); padding: 12px 14px;
        font: 400 12.5px/1.5 system-ui, sans-serif; color: #17191C;
      }
      .${NS}-pop h5 { font: 800 12px/1.3 system-ui; margin: 0 0 6px; color: #B91C1C; }
      .${NS}-pop.${NS}-real h5 { color: #2F7A3D; }
      .${NS}-pop.${NS}-unclear h5 { color: #52575C; }
      .${NS}-pop .sig { display: inline-block; margin: 2px 4px 2px 0; padding: 2px 7px; border-radius: 4px; background: #FEE2E2; color: #B91C1C; font-size: 11px; font-weight: 600; }
      .${NS}-pop.${NS}-real .sig { background: #E4F2E6; color: #2F7A3D; }
      .${NS}-pop.${NS}-unclear .sig { background: #EFF1EE; color: #52575C; }
      .${NS}-pop .sig .n { display: inline-block; min-width: 13px; text-align: center; margin-right: 3px; border-radius: 3px; background: rgba(0,0,0,.08); font-weight: 800; }
      .${NS}-pop .sig.${NS}-hot { outline: 2px solid currentColor; }
      .${NS}-pop .ev { color: #7B8087; font-size: 11.5px; margin-top: 6px; }
      .${NS}-pop .grade { margin-top: 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #7B8087; }
      .${NS}-pop .grade b { color: #17191C; }
      .${NS}-pop .actions { display: flex; gap: 6px; margin-top: 10px; }
      .${NS}-pop button { flex: 1; cursor: pointer; font: 600 11.5px system-ui; border-radius: 999px; padding: 5px 8px; border: 1.5px solid #E3E5E0; background: transparent; color: #17191C; }
      .${NS}-pop button.primary { border-color: #DC2626; background: #DC2626; color: #fff; }
      .${NS}-pop button.warn { border-color: #7B8087; color: #52575C; }
      .${NS}-pop button.ghost { border-color: #E3E5E0; color: #7B8087; }
      .${NS}-pop button:disabled { opacity: .45; cursor: default; }
      .${NS}-pop .close { position: absolute; top: 6px; right: 8px; border: none; background: none; color: #7B8087; font-size: 14px; cursor: pointer; flex: none; padding: 2px 4px; }
      /* v0.6 anchored markers: numbered chips pinned to the cited spot */
      .${NS}-mark {
        position: absolute; pointer-events: auto; cursor: pointer;
        width: 20px; height: 20px; border-radius: 6px;
        background: #DC2626; color: #fff; border: none;
        font: 800 11px/20px system-ui; text-align: center; padding: 0;
        box-shadow: 0 2px 6px rgba(0,0,0,.45);
        animation: ${NS}-in .25s ease;
      }
      .${NS}-mark::after {
        content: ""; position: absolute; left: -7px; top: 19px;
        width: 12px; height: 1.5px; background: rgba(255,255,255,.9);
        transform: rotate(38deg); transform-origin: right center;
      }
      .${NS}-markdot {
        position: absolute; pointer-events: none;
        width: 7px; height: 7px; border-radius: 50%;
        background: #fff; border: 2px solid #DC2626;
        box-shadow: 0 1px 3px rgba(0,0,0,.4);
      }
      /* v0.6 hover-to-scan badge */
      .${NS}-hoverbadge {
        position: absolute; pointer-events: auto; cursor: pointer;
        display: inline-flex; align-items: center; gap: 4px;
        background: rgba(23,25,28,.82); color: #fff; border: none;
        border-radius: 999px; padding: 4px 10px;
        font: 700 11px/1.2 system-ui, sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
        animation: ${NS}-in .15s ease;
      }
      .${NS}-hoverbadge:hover { background: #DC2626; }
      /* v0.6 completion toast */
      .${NS}-toast {
        position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
        pointer-events: none; background: #17191C; color: #fff;
        border-radius: 999px; padding: 8px 16px;
        font: 600 12.5px system-ui, sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.35);
        z-index: 2147483647; animation: ${NS}-in .2s ease;
      }
      @media (prefers-reduced-motion: reduce) { .${NS}-bubble, .${NS}-bubble .dot, .${NS}-mark, .${NS}-hoverbadge, .${NS}-spin { animation: none } }
    `;
    overlay.appendChild(style);
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function docPos(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height };
  }

  function toast(text, ms = 2600) {
    const t = document.createElement("div");
    t.className = NS + "-toast";
    t.textContent = text;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  let sigsThisPage = 0;

  // theme: "ai" (red, default) | "real" (green) | "unclear" (gray) | "info" (gray, transient)
  function themeClass(theme) {
    return theme === "real" ? NS + "-real" : theme === "unclear" ? NS + "-unclear" : theme === "info" ? NS + "-info" : "";
  }

  // grade: "hard" (provable), "record" (community), "hint" (heuristic), "llm"
  function bubble(target, title, signals, grade, opts = {}) {
    const ov = ensureOverlay();
    const p = docPos(target);
    if (p.width < 40 && p.height < 20) return null;

    const b = document.createElement("button");
    b.className = NS + "-bubble " + themeClass(opts.theme);
    b.style.top = Math.max(2, p.top - 26) + "px";
    b.style.left = Math.max(2, p.left + Math.min(p.width - 60, 8)) + "px";
    if (opts.spinner) {
      const sp = document.createElement("span"); sp.className = NS + "-spin"; b.appendChild(sp);
    } else {
      const dot = document.createElement("span"); dot.className = "dot"; b.appendChild(dot);
    }
    b.appendChild(document.createTextNode(title));
    ov.appendChild(b);
    if (!opts.transient) sigsThisPage++;

    // v0.6.1: bubbles on analyzed images ride the same tracking loop as
    // markers — X's lightbox is position:fixed, so document coords drift.
    if (opts.trackTarget) {
      const m = {
        isBubble: true,
        img: opts.trackTarget, nx: 0, ny: 0, dot: document.createElement("span"), chip: b,
      };
      m.dot.style.display = "none"; // bubble-only entry; reuse the mark plumbing
      // custom positioning: bubble sits above the image's top-left
      m.place = () => {
        const r = m.img.getBoundingClientRect();
        const gone = !document.contains(m.img) || (r.width < 40 && r.height < 20);
        b.style.display = gone ? "none" : "";
        if (gone) return;
        b.style.top = Math.max(2, r.top + scrollY - 26) + "px";
        b.style.left = Math.max(2, r.left + scrollX + Math.min(r.width - 60, 8)) + "px";
      };
      marks.push(m);
      if (!tracking) { tracking = true; requestAnimationFrame(trackLoop); }
    }

    let pop = null;
    if (!opts.transient) b.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pop) { pop.remove(); pop = null; return; }
      pop = document.createElement("div");
      pop.className = NS + "-pop " + themeClass(opts.theme);
      pop.style.top = p.top + 16 + "px";
      pop.style.left = Math.max(4, Math.min(p.left, innerWidth - 290 + scrollX)) + "px";

      const h = document.createElement("h5"); h.textContent = title; pop.appendChild(h);
      signals.forEach((s, i) => {
        const chip = document.createElement("span"); chip.className = "sig";
        chip.dataset.n = s._n || "";
        if (s._n) { const n = document.createElement("span"); n.className = "n"; n.textContent = s._n; chip.appendChild(n); }
        chip.appendChild(document.createTextNode(s.label));
        pop.appendChild(chip);
      });
      const evs = signals.filter((s) => s.evidence).map((s) => (s._n ? s._n + ". " : "") + s.evidence);
      if (evs.length) { const ev = document.createElement("div"); ev.className = "ev"; ev.textContent = evs.join(" · "); pop.appendChild(ev); }

      const grades = {
        hard: "<b>Provenance signal</b> · provable, from the content itself",
        record: "<b>Community record</b> · settled by crowd votes",
        hint: "<b>Heuristic hint</b> · pattern match, not proof",
        llm: "<b>LLM analysis</b> · model judgment, not proof",
      };
      const g = document.createElement("div"); g.className = "grade";
      g.innerHTML = (grades[grade] || grades.hint) + (opts.confidence ? " · <b>" + opts.confidence + "</b> confidence" : "");
      pop.appendChild(g);

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
        const fBtn = document.createElement("button");
        // v0.6: flagging is the PRIMARY action only when something was detected.
        // On clean/unclear verdicts it's demoted — flagging a likely-real image
        // is the false-positive path, so it must never look like the default.
        const clean = opts.theme === "real" || opts.theme === "unclear";
        fBtn.className = clean ? "ghost" : "primary";
        fBtn.textContent = clean ? "Disagree? Flag as AI" : "Add to public record";
        fBtn.onclick = async () => {
          fBtn.disabled = true; fBtn.textContent = "Adding…";
          try {
            const note = ("Auto-detected: " + signals.map((s) => s.evidence || s.label).join("; ")).slice(0, 280);
            const r = await FlagDB.addFlag({ url: opts.flagUrl || location.href, signals: signals.map((s) => s.id), note });
            fBtn.textContent = (r.flag && r.flag.offline) ? "Saved locally · ledger unreachable" : "✓ On the record";
          } catch (err) {
            fBtn.textContent = ((err && err.message) || "Failed, try again").slice(0, 60);
            fBtn.disabled = false;
          }
        };
        actions.appendChild(fBtn);
      }
      if (opts.reverseUrl) {
        const rBtn = document.createElement("button");
        if (opts.theme === "real" || opts.theme === "unclear") rBtn.className = "primary"; // clean scans lead with verification, not accusation
        rBtn.textContent = "Reverse search";
        rBtn.onclick = () => window.open("https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(opts.reverseUrl), "_blank");
        actions.appendChild(rBtn);
      }
      const x = document.createElement("button"); x.className = "close"; x.textContent = "×";
      x.onclick = () => { pop.remove(); pop = null; };
      pop.appendChild(x);
      pop.appendChild(actions);
      ov.appendChild(pop);
      if (opts.onPopOpen) opts.onPopOpen(pop);
    });
    return b;
  }

  // ---------- v0.6.1: anchored markers that TRACK their image ----------
  // Only for detected content (ai_generated / ai_edited), only for signals the
  // model actually located. A marker pointing at nothing would undermine the
  // whole credibility play, so unlocated signals stay chip-only.
  //
  // Markers store their target element + normalized anchor and are repositioned
  // from the live bounding rect every frame while any exist. This keeps them
  // glued to the image in X's fixed-position lightbox (where the page scrolls
  // but the image doesn't), in the normal feed, and through layout shifts.
  const marks = []; // { img, nx, ny, dot, chip }
  let tracking = false;

  function positionMark(m) {
    if (m.place) return m.place();
    const r = m.img.getBoundingClientRect();
    const gone = !document.contains(m.img) || r.width < 60 || r.height < 60;
    m.dot.style.display = m.chip.style.display = gone ? "none" : "";
    if (gone) return;
    const ax = r.left + scrollX + Math.max(0.03, Math.min(0.97, m.nx)) * r.width;
    const ay = r.top + scrollY + Math.max(0.03, Math.min(0.97, m.ny)) * r.height;
    m.dot.style.left = (ax - 3.5) + "px"; m.dot.style.top = (ay - 3.5) + "px";
    m.chip.style.left = Math.min(r.left + scrollX + r.width - 24, ax + 8) + "px";
    m.chip.style.top = Math.max(r.top + scrollY + 2, ay - 28) + "px";
  }

  function trackLoop() {
    if (!marks.length) { tracking = false; return; }
    marks.forEach(positionMark);
    requestAnimationFrame(trackLoop);
  }

  function clearMarkersFor(imgEl) {
    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i].isBubble) {
        // bubbles are cleared only when their image leaves the DOM
        if (!document.contains(marks[i].img)) { marks[i].chip.remove(); marks.splice(i, 1); }
        continue;
      }
      if (!imgEl || marks[i].img === imgEl || !document.contains(marks[i].img)) {
        marks[i].dot.remove(); marks[i].chip.remove();
        marks.splice(i, 1);
      }
    }
  }

  function paintMarkers(imgEl, signals, openCard) {
    const ov = ensureOverlay();
    clearMarkersFor(imgEl); // rescans repaint, never duplicate
    const r = imgEl.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) return;
    signals.forEach((s) => {
      if (!s._n || !s._anchor) return;
      const dot = document.createElement("span");
      dot.className = NS + "-markdot";
      const chip = document.createElement("button");
      chip.className = NS + "-mark";
      chip.textContent = s._n;
      chip.title = s.label;
      chip.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        openCard(s._n);
      });
      ov.appendChild(dot); ov.appendChild(chip);
      const m = { img: imgEl, nx: s._anchor.x, ny: s._anchor.y, dot, chip };
      marks.push(m);
      positionMark(m);
    });
    if (marks.length && !tracking) { tracking = true; requestAnimationFrame(trackLoop); }
  }

  // ---------- v0.6: hover-to-scan badge (the discoverability fix) ----------
  let hoverBadge = null, hoverTarget = null, hoverHideTimer = null;
  function removeHoverBadge() { if (hoverBadge) { hoverBadge.remove(); hoverBadge = null; hoverTarget = null; } }
  document.addEventListener("mouseover", async (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img === hoverTarget) return;
    if (!(await state())) return;
    const r = img.getBoundingClientRect();
    if (r.width < 180 || r.height < 120) return;
    const src = img.currentSrc || img.src || "";
    if (!src.startsWith("http")) return;
    removeHoverBadge();
    hoverTarget = img;
    const ov = ensureOverlay();
    const p = docPos(img);
    hoverBadge = document.createElement("button");
    hoverBadge.className = NS + "-hoverbadge";
    hoverBadge.textContent = "⚑ Scan image";
    hoverBadge.style.top = (p.top + 8) + "px";
    hoverBadge.style.left = (p.left + p.width - 104) + "px";
    hoverBadge.addEventListener("click", (e2) => {
      e2.preventDefault(); e2.stopPropagation();
      removeHoverBadge();
      analyzeImage(src);
    });
    ov.appendChild(hoverBadge);
    clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(removeHoverBadge, 3500);
  }, { passive: true });
  document.addEventListener("scroll", removeHoverBadge, { passive: true });

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
    const scored = new Map();
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

  // ---------- LLM deep scan (text) ----------
  async function deepScan() {
    const main = document.querySelector("article, main") || document.body;
    const text = (main.innerText || "").replace(/\s+/g, " ").slice(0, 6000);
    if (text.length < 300) {
      toast("Not enough text on this page to analyze");
      return { ok: true, found: 0 };
    }
    const loading = bubble(main, "Analyzing page text…", [], "llm", { theme: "info", spinner: true, transient: true });
    let res;
    try {
      res = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "flagged-fetch",
          url: (FlagDB.API || "https://flagged-api.vercel.app") + "/v1/analyze",
          options: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) },
        }, (r) => (chrome.runtime.lastError || !r) ? reject(new Error("relay")) : resolve(r));
      });
    } catch { loading && loading.remove(); toast("Can't reach the analysis API"); return { ok: false, error: "Can't reach the analysis API" }; }
    loading && loading.remove();
    if (res.status === 501) { toast("LLM analysis isn't enabled on the server"); return { ok: false, error: "LLM analysis isn't enabled on the server yet" }; }
    if (!res.ok) { toast("Analysis failed (" + (res.status || "network") + ")"); return { ok: false, error: "Analysis failed (" + (res.status || "network") + ")" }; }
    let data = {};
    try { data = JSON.parse(res.body || "{}"); } catch { toast("Bad analysis response"); return { ok: false, error: "Bad analysis response" }; }
    const sigs = (data.signals || []).slice(0, 5).map((s) => ({ id: s.id || "detector", label: s.label || s.id, evidence: s.evidence }));
    if (!sigs.length || (data.likelihood || 0) < 0.5) {
      toast("Scanned page text · no AI signatures found");
      return { ok: true, found: 0 };
    }
    bubble(document.querySelector("article, main") || document.body,
      "LLM analysis: " + Math.round((data.likelihood || 0) * 100) + "% AI-likely",
      sigs, "llm", { confidence: data.confidence });
    toast("Scanned page text · " + sigs.length + " signature" + (sigs.length === 1 ? "" : "s") + " found");
    return { ok: true, found: sigs.length };
  }

  // ---------- lifecycle ----------
  function clearAll() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (observer) { observer.disconnect(); observer = null; }
    marks.length = 0; // overlay removal took the nodes with it
    scanned = false;
    sigsThisPage = 0;
  }

  let rescanTimer = null;

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
    setTimeout(rescan, 1200);
    setTimeout(rescan, 3500);
    setTimeout(rescan, 8000);
    observer = new MutationObserver(() => {
      if (rescanTimer) return;
      rescanTimer = setTimeout(() => { rescanTimer = null; rescan(); }, 1200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

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

    ensureOverlay();
    // v0.6: instant feedback — this is the fix for "right click did nothing"
    const loading = bubble(img, "Analyzing image…", [], "llm", { theme: "info", spinner: true, transient: true });

    const sigs = [];
    let grade = "llm";
    let title = null;
    let theme = "ai";
    let confidence = null;

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
    let category = null;
    try {
      const res = await new Promise((resolve, reject) =>
        chrome.runtime.sendMessage({
          type: "flagged-fetch",
          url: (FlagDB.API || "https://flagged-api.vercel.app") + "/v1/analyze-image",
          options: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image_url: srcUrl }) },
        }, (r) => (chrome.runtime.lastError || !r) ? reject(new Error("relay")) : resolve(r)));
      if (res.ok) {
        const data = JSON.parse(res.body || "{}");
        category = data.category;
        confidence = data.confidence || null;
        const cats = { ai_generated: "AI-generated", ai_edited: "AI-edited (real photo, altered)", likely_real: "no artifacts found · not proof it's real", unclear: "couldn't determine" };
        if (!title) title = "Image analysis: " + (cats[category] || "couldn't determine") +
          ((category === "ai_generated" || category === "ai_edited") && data.likelihood >= 0.5 ? " · " + Math.round(data.likelihood * 100) + "%" : "");
        // theme follows the verdict: red is earned, not default
        if (grade !== "hard") theme = category === "likely_real" ? "real" : (category === "ai_generated" || category === "ai_edited") ? "ai" : "unclear";
        let n = 0;
        const located = category === "ai_generated" || category === "ai_edited";
        for (const sg of (data.signals || []).slice(0, 5)) {
          const VALID = new Set(["metadata","anatomy","voice","phrasing","cadence","account","facts","detector","reverse","disclosed"]);
          const rawId = String(sg.id || "detector");
          const s = { id: VALID.has(rawId) ? rawId : (rawId.startsWith("anatomy") ? "anatomy" : "detector"), label: sg.label || "Visual artifact", evidence: sg.evidence };
          // number + anchor only detected-content signals the model located
          if (located && sg.anchor && typeof sg.anchor.x === "number" && typeof sg.anchor.y === "number") {
            s._n = ++n;
            s._anchor = sg.anchor;
          }
          sigs.push(s);
        }
        if (!sigs.length) sigs.push({ id: "detector", label: cats[category] || "Couldn't determine", evidence: "no visible generation or manipulation artifacts" });
      } else {
        const errBody = (() => { try { return JSON.parse(res.body || "{}").error; } catch { return null; } })();
        if (!sigs.length) { title = "Image analysis unavailable"; theme = "unclear"; sigs.push({ id: "detector", label: "Not analyzed", evidence: errBody || "server declined (" + res.status + ")" }); }
      }
    } catch {
      if (!sigs.length) { title = "Image analysis unavailable"; theme = "unclear"; sigs.push({ id: "detector", label: "Not analyzed", evidence: "could not reach the analysis API" }); }
    }

    loading && loading.remove();

    const verdictBubble = bubble(img, title || "Image analysis", sigs, grade, {
      trackTarget: img !== document.body ? img : null,
      theme,
      confidence,
      flagUrl: srcUrl.startsWith("http") ? srcUrl : location.href,
      reverseUrl: srcUrl,
      onPopOpen: (pop) => {
        // marker click → highlight the matching numbered chip
        pop.querySelectorAll(".sig[data-n]").forEach((c) => c.classList.remove(NS + "-hot"));
      },
    });

    // paint anchored markers on the image itself (detected content only)
    if (img !== document.body && sigs.some((s) => s._anchor)) {
      paintMarkers(img, sigs, (n) => {
        if (verdictBubble) verdictBubble.click();
        setTimeout(() => {
          document.querySelectorAll("." + NS + "-pop .sig").forEach((c) => {
            c.classList.toggle(NS + "-hot", c.dataset.n === String(n));
          });
        }, 60);
      });
    }
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
