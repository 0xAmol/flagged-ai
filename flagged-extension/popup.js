// popup.js — flag.ai popup
let tabUrl = null;
let selectedSignals = [];

const $ = (id) => document.getElementById(id);

init();

async function init() {
  // Context menu flow passes ?url=...; otherwise use the active tab.
  const qp = new URLSearchParams(location.search);
  if (qp.get("url")) {
    tabUrl = qp.get("url");
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabUrl = tab && tab.url ? tab.url : null;
  }

  if (!tabUrl || !/^https?:/.test(tabUrl)) {
    $("status").innerHTML = `<span class="badge unverified">n/a</span>
      <p class="note">This page can't be flagged (browser or extension page).</p>`;
    return;
  }

  try { $("host").textContent = new URL(tabUrl).hostname.replace(/^www\./, ""); } catch {}
  render();
}

async function render() {
  const flags = await FlagDB.getFlagsForUrl(tabUrl);

  if (flags.length === 0) {
    $("status").innerHTML = `<span class="badge clean">no flags on record</span>
      <p class="note">Nobody has flagged this page yet. Think it's AI? Put it on the record.</p>`;
    renderForm();
    return;
  }

  const f = flags[0];
  const status = FlagDB.statusOf(f);
  const myVote = await FlagDB.getMyVote(f.id);
  const total = (f.votes.confirm || 0) + (f.votes.dispute || 0);
  const chips = (f.signals || [])
    .map((sid) => {
      const s = FlagDB.SIGNALS.find((x) => x.id === sid);
      return s ? `<span class="chip">${s.label}</span>` : "";
    })
    .join("");

  $("status").innerHTML = `
    <span class="badge ${status}">${
      status === "confirmed" ? "AI · confirmed" :
      status === "unverified" ? "AI · unverified" : status
    }</span>
    <div class="chips">${chips}</div>
    ${f.note ? `<p class="note">${escapeHtml(f.note)}</p>` : ""}
    <div class="counts">${f.votes.confirm || 0} confirm · ${f.votes.dispute || 0} dispute${
      total < 3 ? ` · needs ${3 - total} more` : ""
    }</div>
    <div class="row">
      <button class="confirm ${myVote === "confirm" ? "active" : ""}" id="vc" ${myVote ? "disabled" : ""}>
        ${myVote === "confirm" ? "✓ Confirmed" : "Confirm AI"}
      </button>
      <button class="dispute ${myVote === "dispute" ? "active" : ""}" id="vd" ${myVote ? "disabled" : ""}>
        ${myVote === "dispute" ? "✓ Disputed" : "Dispute"}
      </button>
    </div>`;
  $("flagform").innerHTML = "";

  if (!myVote) {
    $("vc").onclick = async () => { await FlagDB.voteFlag(f.id, "confirm"); render(); pingTab(); };
    $("vd").onclick = async () => { await FlagDB.voteFlag(f.id, "dispute"); render(); pingTab(); };
  }
}

function renderForm() {
  const type = FlagDB.detectType(tabUrl);
  $("flagform").innerHTML = `
    <div class="label">Signatures — what gives it away?</div>
    <div class="signals" id="sigs">
      ${FlagDB.SIGNALS.map((s) => `<button class="sig" data-id="${s.id}">${s.label}</button>`).join("")}
    </div>
    <div class="label">Evidence (optional)</div>
    <textarea id="note" rows="2" maxlength="280" placeholder="Detector score, the exact artifact, timestamps…"></textarea>
    <div class="err" id="err" hidden></div>
    <div class="row"><button class="primary" id="submit">Flag as AI · ${type}</button></div>
    <div class="fine">Flags are public on the flag.ai record.</div>`;

  document.querySelectorAll(".sig").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (selectedSignals.includes(id)) {
        selectedSignals = selectedSignals.filter((x) => x !== id);
        btn.classList.remove("on");
      } else {
        selectedSignals.push(id);
        btn.classList.add("on");
      }
      $("err").hidden = true;
    };
  });

  $("submit").onclick = async () => {
    if (selectedSignals.length === 0) {
      $("err").textContent = "Pick at least one signature — flags need evidence.";
      $("err").hidden = false;
      return;
    }
    await FlagDB.addFlag({ url: tabUrl, type, signals: selectedSignals, note: $("note").value });
    selectedSignals = [];
    render();
    pingTab();
  };
}

// Tell the content script on the active tab to refresh its banner.
async function pingTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: "flagai-refresh" });
  } catch {}
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
