// background.js — Artifake service worker
// Fetch relay for strict-CSP sites, context menus, metadata sniffing, and
// (v0.8) the video burst-sampler: captures ~5 frames of the visible tab over
// ~10 seconds, downscales them, and sends them for temporal analysis. The
// sampler lives here — not in the popup — so closing the popup doesn't kill
// a scan in progress. Progress and results persist in chrome.storage.local
// under "flagged_video" so any popup instance can render them.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "flagai-flag-link",
    title: "Flag as AI on Artifake",
    contexts: ["link", "page", "video"],
  });
  chrome.contextMenus.create({
    id: "flagai-scan-image",
    title: "Deep scan image with Artifake",
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

// ---------- v0.8 video burst-sampler ----------
const API = "https://flagged-api.vercel.app";
const FRAMES = 5;
const INTERVAL_MS = 2200; // safely inside Chrome's captureVisibleTab rate limit
const MAX_W = 960;

let videoRunning = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function abToB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function setVideoState(state) {
  await chrome.storage.local.set({ flagged_video: { ...state, ts: Date.now() } });
}

async function captureFrame(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 88 });
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_W / bmp.width);
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.78 });
  return abToB64(await out.arrayBuffer());
}

async function videoScan(windowId, tabId) {
  if (videoRunning) return;
  videoRunning = true;
  try {
    const frames = [];
    for (let i = 1; i <= FRAMES; i++) {
      await setVideoState({ status: "sampling", frame: i, total: FRAMES });
      try {
        frames.push(await captureFrame(windowId));
      } catch (e) {
        if (frames.length === 0) {
          await setVideoState({ status: "error", error: "Can't capture this page (browser page?)" });
          return;
        }
        break; // keep what we have (tab switched, etc.)
      }
      if (i < FRAMES) await sleep(INTERVAL_MS);
    }

    await setVideoState({ status: "analyzing", frame: frames.length, total: FRAMES });

    // 2+ frames -> temporal analysis; 1 frame -> single-image fallback
    const endpoint = frames.length >= 2 ? "/v1/analyze-frames" : "/v1/analyze-upload";
    const payload = frames.length >= 2
      ? { media_type: "image/jpeg", frames }
      : { media_type: "image/jpeg", image_base64: frames[0] };

    let res, data = {};
    try {
      res = await fetch(API + endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-flagged-key": await identityKey() },
        body: JSON.stringify(payload),
      });
      try { data = await res.json(); } catch {}
    } catch {
      await setVideoState({ status: "error", error: "Can't reach the analysis API" });
      return;
    }
    if (!res.ok) {
      await setVideoState({ status: "error", error: data.error || ("Analysis failed (" + res.status + ")") });
      return;
    }
    await setVideoState({ status: "done", result: data, frames_sent: frames.length });
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: "flagged-video-result", result: data, frames_sent: frames.length }).catch(() => {});
    }
    const bad = data.category === "ai_generated" || data.category === "ai_edited";
    chrome.action.setBadgeBackgroundColor({ color: bad ? "#DC2626" : "#16A34A" });
    chrome.action.setBadgeText({ text: bad ? "AI" : "✓" });
  } finally {
    videoRunning = false;
  }
}

async function identityKey() {
  const r = await chrome.storage.local.get("flagged_identity_key");
  if (r.flagged_identity_key) return r.flagged_identity_key;
  const key = "ext_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  await chrome.storage.local.set({ flagged_identity_key: key });
  return key;
}

// ---------- message hub ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "flagged-video-scan") {
    videoScan(msg.windowId ?? null, msg.tabId ?? null);
    sendResponse({ ok: true, started: true });
    return; // sync ack; progress flows through storage
  }
  if (msg && msg.type === "flagged-video-ack") {
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return;
  }
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
