// background.js — flagged.ai service worker
// Also acts as a fetch relay: content scripts on strict-CSP sites (x.com etc)
// can't call our API directly, so they ask the worker to do it.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "flagai-flag-link",
    title: "Flag as AI on flagged.ai",
    contexts: ["link", "page", "video"],
  });
  chrome.contextMenus.create({
    id: "flagai-scan-image",
    title: "Deep scan image with flagged.ai",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "flagai-scan-image" && info.srcUrl && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "flagged-analyze-image", srcUrl: info.srcUrl }).catch(() => {});
    return;
  }
  const target = info.linkUrl || info.srcUrl || info.pageUrl;
  if (!target) return;
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?url=" + encodeURIComponent(target)),
    type: "popup",
    width: 372,
    height: 620,
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "flagged-sniff") {
    // metadata forensics: look for provenance markers in the image bytes
    fetch(msg.url, { headers: { accept: "image/*" } })
      .then(async (r) => {
        const buf = new Uint8Array(await r.arrayBuffer());
        const head = buf.slice(0, 524288);
        let ascii = "";
        for (let i = 0; i < head.length; i++) { const c = head[i]; ascii += (c > 31 && c < 127) ? String.fromCharCode(c) : "."; }
        const markers = [];
        for (const m of ["c2pa", "jumb", "contentauth", "Adobe Firefly", "Midjourney", "DALL-E", "DALL\u00b7E", "Stable Diffusion", "SDXL", "ComfyUI", "Grok", "Imagen", "SynthID"]) {
          if (ascii.toLowerCase().includes(m.toLowerCase())) markers.push(m);
        }
        sendResponse({ ok: true, markers });
      })
      .catch(() => sendResponse({ ok: false, markers: [] }));
    return true;
  }
  if (msg && msg.type === "flagged-fetch") {
    fetch(msg.url, msg.options || {})
      .then(async (r) => sendResponse({ ok: r.ok, status: r.status, body: await r.text() }))
      .catch((e) => sendResponse({ ok: false, status: 0, body: "", error: String(e) }));
    return true; // async
  }
});
