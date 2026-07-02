// background.js — flag.ai service worker
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "flagai-flag-link",
    title: "Flag as AI on flag.ai",
    contexts: ["link", "page", "image", "video"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  const target = info.linkUrl || info.srcUrl || info.pageUrl;
  if (!target) return;
  // Open the popup flow in a small window, pre-loaded with the target URL.
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?url=" + encodeURIComponent(target)),
    type: "popup",
    width: 392,
    height: 560,
  });
});
