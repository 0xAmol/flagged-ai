// background.js — flagged.ai service worker
// Also acts as a fetch relay: content scripts on strict-CSP sites (x.com etc)
// can't call our API directly, so they ask the worker to do it.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "flagai-flag-link",
    title: "Flag as AI on flagged.ai",
    contexts: ["link", "page", "image", "video"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
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
  if (msg && msg.type === "flagged-fetch") {
    fetch(msg.url, msg.options || {})
      .then(async (r) => sendResponse({ ok: r.ok, status: r.status, body: await r.text() }))
      .catch((e) => sendResponse({ ok: false, status: 0, body: "", error: String(e) }));
    return true; // async
  }
});
