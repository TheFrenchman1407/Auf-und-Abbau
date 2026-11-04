// Minimaler Service Worker: macht die Seite installierbar. Daten kommen immer live vom Server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
