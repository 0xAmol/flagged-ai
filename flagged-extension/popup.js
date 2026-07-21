// popup.js — Artifake v0.7 controller
// Built on the shipped v0.3: adds "Scan images on this page", per-button busy
// states, manual scans that work regardless of the passive toggle, footer
// version from the manifest, and honest completion toasts.
let tabUrl = null, tabId = null;
const $ = (id) => document.getElementById(id);

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab && tab.url ? tab.url : null;
  tabId = tab ? tab.id : null;
  const isWeb = !!(tabUrl && /^https?:/.test(tabUrl));
  if (isWeb) {
    try { $("host").textContent = new URL(tabUrl).hostname.replace(/^www\./, ""); } catch {}
  }

  $("ver").textContent = "v" + chrome.runtime.getManifest().version;

  const st = await chrome.storage.local.get(["flagged_on", "flagged_stats"]);
  renderPower(st.flagged_on === true);
  renderStats(st.flagged_stats || { pages: 0, sigs: 0 });

  // manual scans are explicit user intent: enabled whenever we're on a real page
  $("imagescan").disabled = !isWeb;
  $("deepscan").disabled = !isWeb;
  $("screenscan").disabled = !isWeb;

  $("power").onclick = toggle;
  $("cta").onclick = toggle;
  $("status").onclick = async () => {
    const st2 = await chrome.storage.local.get("flagged_on");
    if (st2.flagged_on !== true) toggle();
  };
  $("imagescan").onclick = () => run("imagescan", imageScan);
  $("deepscan").onclick = () => run("deepscan", deepScan);
  $("screenscan").onclick = () => run("screenscan", screenScan);

  chrome.storage.onChanged.addListener((chg) => {
    if (chg.flagged_stats) renderStats(chg.flagged_stats.newValue || { pages: 0, sigs: 0 });
    if (chg.flagged_video) renderVideoState(chg.flagged_video.newValue);
  });

  // a video scan may have run (or still be running) from a previous popup
  const vs = await chrome.storage.local.get("flagged_video");
  renderVideoState(vs.flagged_video);

  renderLedger();
}

// one-at-a-time busy wrapper: pulses the button, restores when done
let busy = false;
async function run(id, fn) {
  if (busy) return;
  busy = true;
  const b = $(id);
  b.classList.add("busy");
  try { await fn(); } finally { b.classList.remove("busy"); busy = false; }
}

function renderPower(on) {
  $("power").classList.toggle("on", on);
  $("power").classList.toggle("attn", !on);
  $("pwrap").classList.toggle("on", on);
  $("cta").hidden = on;
  $("host").style.display = on ? "" : "none";
  const s = $("status");
  s.classList.toggle("on", on);
  s.childNodes[1].textContent = on ? "Scanning on " : "Not scanning ";
  $("statussub").textContent = on
    ? "· marking AI signatures as you browse"
    : "· tap the power button to start";
}

async function toggle() {
  const st = await chrome.storage.local.get("flagged_on");
  const on = !(st.flagged_on === true);
  await chrome.storage.local.set({ flagged_on: on });
  renderPower(on);
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id && t.url && /^https?:/.test(t.url)) {
      chrome.tabs.sendMessage(t.id, { type: on ? "flagged-scan" : "flagged-clear" }).catch(() => {});
    }
  }
}

function renderStats(s) {
  $("st-pages").textContent = s.pages || 0;
  $("st-sigs").textContent = s.sigs || 0;
}

function toast(msg, ms = 5000) {
  $("toast").textContent = msg;
  if (ms) setTimeout(() => { if ($("toast").textContent === msg) $("toast").textContent = ""; }, ms);
}

async function imageScan() {
  if (!tabId) return;
  toast("Scanning images on the page…", 0);
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "flagged-scan-images", limit: 3 });
    if (res && res.ok) {
      toast(res.scanned
        ? "Scanned " + res.scanned + " image" + (res.scanned === 1 ? "" : "s") + " — results are marked on the page"
        : "No large images in view — scroll to the image and try again");
    } else {
      toast((res && res.error) || "Image scan unavailable");
    }
  } catch {
    toast("Reload the page once, then try again");
  }
}

async function deepScan() {
  if (!tabId) return;
  toast("Analyzing page text…", 0);
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "flagged-deepscan" });
    if (res && res.ok) {
      toast(res.found
        ? "Analysis done: " + res.found + " signature" + (res.found === 1 ? "" : "s") + " marked on the page"
        : "Analysis done: no strong AI signatures in this page's text");
    } else {
      toast((res && res.error) || "Text scan unavailable");
    }
  } catch {
    toast("Reload the page once, then try again");
  }
}

// ---- community record ----
async function renderLedger() {
  if (!tabUrl || !/^https?:/.test(tabUrl)) return;
  let flags = [];
  try { flags = await FlagDB.getFlagsForUrl(tabUrl); } catch { return; }
  const box = $("ledger"), body = $("ledger-body");
  box.hidden = false;
  if (!flags.length) {
    body.innerHTML = '<span class="badge clean">no flags on record</span>';
    return;
  }
  const f = flags[0];
  const status = FlagDB.statusOf(f);
  const myVote = await FlagDB.getMyVote(f.id);
  const label = status === "confirmed" ? "AI · confirmed" : status === "unverified" ? "AI · unverified" : status;
  body.innerHTML = `
    <span class="badge ${status}">${label}</span>
    ${f.note ? `<div style="margin-top:8px;font-size:12.5px;line-height:1.45">${escapeHtml(f.note)}</div>` : ""}
    <div class="counts">${f.votes.confirm || 0} confirm · ${f.votes.dispute || 0} dispute</div>
    <div class="vrow">
      <button class="confirm ${myVote === "confirm" ? "active" : ""}" id="vc" ${myVote ? "disabled" : ""}>${myVote === "confirm" ? "✓ Confirmed" : "Confirm AI"}</button>
      <button class="dispute ${myVote === "dispute" ? "active" : ""}" id="vd" ${myVote ? "disabled" : ""}>${myVote === "dispute" ? "✓ Disputed" : "Dispute"}</button>
    </div>`;
  if (!myVote) {
    const cast = async (side) => {
      const r = await FlagDB.voteFlag(f.id, side);
      if (r && r.ok === false && r.reason === "already-voted") {
        toast("Already counted: submitting a flag includes your confirm vote", 4500);
      }
      renderLedger();
    };
    $("vc").onclick = () => cast("confirm");
    $("vd").onclick = () => cast("dispute");
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- check a video: worker samples ~5 frames over ~10s, temporal analysis ----
// Sampling runs in the background worker so closing this popup doesn't kill
// it. Progress and the verdict persist in storage; we render whatever state
// exists, live — including on popup reopen.
async function screenScan() {
  $("scanresult").hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "flagged-video-scan", windowId: tab ? tab.windowId : null, tabId: tab ? tab.id : null }, () => resolve()));
  // hold the button's busy state until the worker reports done/error
  await new Promise((resolve) => {
    const done = (st) => st && (st.status === "done" || st.status === "error");
    chrome.storage.local.get("flagged_video").then((r) => { if (done(r.flagged_video)) resolve(); });
    const listener = (chg) => {
      if (chg.flagged_video && done(chg.flagged_video.newValue)) {
        chrome.storage.onChanged.removeListener(listener);
        resolve();
      }
    };
    chrome.storage.onChanged.addListener(listener);
  });
}

function renderVideoState(st) {
  if (!st) return;
  const fresh = !st.ts || Date.now() - st.ts < 10 * 60 * 1000;
  if (st.status === "sampling") { toast("Watching the video… frame " + st.frame + " of " + st.total, 0); return; }
  if (st.status === "analyzing") { toast("Analyzing " + st.frame + " frames for temporal artifacts…", 0); return; }
  if (!fresh) return; // don't resurrect old verdicts on popup open
  if (st.status === "error") { toast(st.error || "Video check failed"); return; }
  if (st.status === "done") {
    toast("");
    chrome.runtime.sendMessage({ type: "flagged-video-ack" }).catch(() => {});
    renderVideoResult(st.result, st.frames_sent);
  }
}

function renderVideoResult(d, framesSent) {
  if (!d) return;
  const cats = {
    ai_generated: ["confirmed", "AI-generated"],
    ai_edited: ["confirmed", "AI-edited · altered"],
    likely_real: ["clean", "no artifacts found"],
    unclear: ["unverified", "couldn't determine"],
  };
  const [cls, label] = cats[d.category] || cats.unclear;
  $("scanresult").hidden = false;
  $("scanresult-body").innerHTML =
    '<span class="badge ' + cls + '">' + label + (d.likelihood >= 0.5 ? " · " + Math.round(d.likelihood * 100) + "%" : "") + "</span>" +
    (d.signals || []).map((s) => {
      const fr = (s.frames && s.frames.length) ? ' <span style="color:#7B8087;font-weight:400">(frame' + (s.frames.length > 1 ? "s " : " ") + s.frames.join("–") + ")</span>" : "";
      return '<div class="srow"><b>' + escapeHtml(s.label || "") + "</b>" + fr + '<span class="ev">' + escapeHtml(s.evidence || "") + "</span></div>";
    }).join("") +
    '<div class="counts">' + (framesSent >= 2 ? framesSent + " frames · temporal analysis" : "single frame") +
    " · model judgment, not proof · frames not stored" +
    (d.confidence ? " · " + escapeHtml(d.confidence) + " confidence" : "") + "</div>";
}

