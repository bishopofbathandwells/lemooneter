// Minimal cache-first service worker so the app works offline once visited.
const CACHE = "lemooneter-v17";
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./astro.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-maskable.svg",
  "./fruits/moon.webp",
  "./fruits/lemon.webp",
  "./fruits/lime.webp",
  "./fruits/orange.webp",
  "./fruits/cheese-moon.webp",
  "./fruits/smiley.webp",
  "./fruits/watermelon.webp",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
