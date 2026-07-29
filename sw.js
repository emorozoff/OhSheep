/* ==========================================================================
   sw.js — офлайн-кэш. Приложение целиком статическое, так что достаточно
   положить оболочку в кэш и отдавать её первой.
   При правках бампни VERSION, иначе браузер продолжит отдавать старое.
   ========================================================================== */

const VERSION = "ohsheep-v6";

const SHELL = [
  "./",
  "./index.html",
  "./src/styles.css",
  "./src/app.js",
  "./src/audio.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/bg.webp",
  "./assets/splash.webp",
  "./assets/sheep-stand.webp",
  "./assets/sheep-sigh.webp",
  "./assets/sheep-jump.webp",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((cache) =>
      // кладём по одному: отсутствующая иконка не должна ломать установку
      Promise.all(SHELL.map((url) =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => {})
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        // тихо обновляем кэш в фоне
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          req.mode === "navigate"
            ? caches.match("./index.html")
            : Response.error()
        );
    })
  );
});
