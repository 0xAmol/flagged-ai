// Minimal service worker: makes Artifake installable as an app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
self.addEventListener("fetch", (e) => { /* network passthrough */ });
