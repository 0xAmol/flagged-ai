// content.js — shows a small banner on pages that are on the flag.ai record.
(async function () {
  if (window.top !== window) return; // skip iframes

  async function check() {
    const old = document.getElementById("flagai-banner");
    if (old) old.remove();

    let flags = [];
    try {
      flags = await FlagDB.getFlagsForUrl(location.href);
    } catch {
      return;
    }
    if (!flags.length) return;

    const f = flags[0];
    const status = FlagDB.statusOf(f);
    if (status === "disputed") return; // crowd rejected the flag — no banner

    const colors = {
      confirmed: "#4630B8",
      unverified: "#7B8087",
      contested: "#B0770F",
    };
    const label = {
      confirmed: "AI · confirmed",
      unverified: "AI · unverified",
      contested: "AI · contested",
    };

    const el = document.createElement("div");
    el.id = "flagai-banner";
    el.setAttribute("role", "note");
    el.style.cssText = [
      "position:fixed", "top:14px", "right:14px", "z-index:2147483647",
      "display:flex", "align-items:center", "gap:8px",
      "background:#fff", "color:#17191C",
      `border:1.5px solid ${colors[status]}`,
      "border-radius:999px", "padding:7px 8px 7px 14px",
      "font:600 12.5px system-ui,sans-serif",
      "box-shadow:0 4px 16px rgba(0,0,0,.14)",
      "cursor:default",
    ].join(";");

    const total = (f.votes.confirm || 0) + (f.votes.dispute || 0);
    el.innerHTML = `
      <span style="color:${colors[status]}">⚑ ${label[status]}</span>
      <span style="color:#7B8087;font-weight:500">${f.votes.confirm || 0}/${total}</span>
      <button id="flagai-close" aria-label="Dismiss" style="
        border:none;background:#F6F7F5;color:#7B8087;border-radius:999px;
        width:20px;height:20px;line-height:1;cursor:pointer;font-size:12px">×</button>`;

    document.documentElement.appendChild(el);
    el.querySelector("#flagai-close").onclick = () => el.remove();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "flagai-refresh") check();
  });

  check();
})();
