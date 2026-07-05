// popup.js — flagged.ai v0.3, VPN-style controller
let tabUrl = null, tabId = null;
const $ = (id) => document.getElementById(id);

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab && tab.url ? tab.url : null;
  tabId = tab ? tab.id : null;
  if (tabUrl && /^https?:/.test(tabUrl)) {
    try { $("host").textContent = new URL(tabUrl).hostname.replace(/^www\./, ""); } catch {}
  }

  const st = await chrome.storage.local.get(["flagged_on", "flagged_stats"]);
  renderPower(st.flagged_on === true);
  renderStats(st.flagged_stats || { pages: 0, sigs: 0 });

  $("power").onclick = toggle;
  $("deepscan").onclick = deepScan;
  $("screenscan").onclick = screenScan;

  // stats update live while popup is open
  chrome.storage.onChanged.addListener((chg) => {
    if (chg.flagged_stats) renderStats(chg.flagged_stats.newValue || { pages: 0, sigs: 0 });
  });

  renderLedger();
}

function renderPower(on) {
  $("power").classList.toggle("on", on);
  $("pwrap").classList.toggle("on", on);
  $("zone").classList.toggle("on", on);
  const s = $("status");
  s.classList.toggle("on", on);
  s.innerHTML = on
    ? 'Scanning on<span class="sub">AI signatures will be marked on pages as you browse</span>'
    : 'Not scanning<span class="sub">Turn on to mark AI signatures on the pages you visit</span>';
  $("deepscan").disabled = !on;
  $("screenscan").disabled = !on;
  $("deephint").textContent = on
    ? "LLM signature analysis of this page's text"
    : "LLM signature analysis · turn scanning on first";
}

async function toggle() {
  const st = await chrome.storage.local.get("flagged_on");
  const on = !(st.flagged_on === true);
  await chrome.storage.local.set({ flagged_on: on });
  renderPower(on);
  // nudge every open tab so bubbles appear/disappear immediately
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

async function deepScan() {
  if (!tabId) return;
  $("toast").textContent = "Analyzing page text…";
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "flagged-deepscan" });
    if (res && res.ok) {
      $("toast").textContent = res.found
        ? `Analysis done: ${res.found} signature${res.found === 1 ? "" : "s"} marked on the page`
        : "Analysis done: no strong AI signatures in this page's text";
    } else {
      $("toast").textContent = (res && res.error) || "Deep scan unavailable";
    }
  } catch {
    $("toast").textContent = "Reload the page once, then try again";
  }
  setTimeout(() => ($("toast").textContent = ""), 5000);
}

// ---- community record (secondary) ----
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
        $("toast").textContent = "Already counted: submitting a flag includes your confirm vote";
        setTimeout(() => ($("toast").textContent = ""), 4500);
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


// ---- scan visible screen: capture tab, downscale, vision-analyze ----
async function screenScan() {
  $("toast").textContent = "Capturing screen\u2026";
  $("scanresult").hidden = true;
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 88 });
  } catch (e) {
    $("toast").textContent = "Can't capture this page (browser page?)";
    return;
  }
  // downscale to keep uploads small and cheap
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const maxW = 1400;
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

  $("toast").textContent = "Analyzing\u2026 a few seconds";
  let res;
  try {
    res = await new Promise((resolve, reject) =>
      chrome.runtime.sendMessage({
        type: "flagged-fetch",
        url: (FlagDB.API || "https://flagged-api.vercel.app") + "/v1/analyze-upload",
        options: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image_base64: b64, media_type: "image/jpeg" }) },
      }, (r) => (chrome.runtime.lastError || !r) ? reject(new Error("relay")) : resolve(r)));
  } catch { $("toast").textContent = "Can't reach the analysis API"; return; }
  $("toast").textContent = "";
  let d = {};
  try { d = JSON.parse(res.body || "{}"); } catch {}
  if (!res.ok) { $("toast").textContent = d.error || res.error || ("Analysis failed (" + res.status + ")"); return; }

  const cats = {
    ai_generated: ["confirmed", "AI-generated"],
    ai_edited: ["confirmed", "AI-edited \u00b7 altered"],
    likely_real: ["clean", "no artifacts found"],
    unclear: ["unverified", "inconclusive"],
  };
  const [cls, label] = cats[d.category] || cats.unclear;
  $("scanresult").hidden = false;
  $("scanresult-body").innerHTML =
    '<span class="badge ' + cls + '">' + label + (d.likelihood >= 0.5 ? " \u00b7 " + Math.round(d.likelihood * 100) + "%" : "") + "</span>" +
    (d.signals || []).map((s) => '<div class="srow"><b>' + escapeHtml(s.label || "") + '</b><span class="ev">' + escapeHtml(s.evidence || "") + "</span></div>").join("") +
    '<div class="counts">LLM analysis \u00b7 model judgment, not proof \u00b7 image not stored</div>';
}
