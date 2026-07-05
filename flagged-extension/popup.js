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
