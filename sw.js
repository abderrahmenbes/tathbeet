// خدمة التطبيق: تُبقي التطبيق يفتح بسرعة وبدون إنترنت، وتأتي النسخة الجديدة دائمًا من الشبكة أولًا
const CACHE = "tathbeet-shell-v1";
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k.startsWith("tathbeet-")).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.hostname.endsWith("supabase.co")) return;               // البيانات دائمًا من الشبكة
  if (r.cache === "no-store" || r.cache === "no-cache") return;  // فحص التحديث يتجاوز الذاكرة

  if (r.mode === "navigate") {                                   // الصفحة: الشبكة أولًا ثم النسخة المحفوظة
    e.respondWith(
      fetch(r.url, { cache: "no-cache" })
        .then((res) => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put("./", cp)); } return res; })
        .catch(() => caches.match("./").then((x) => x || new Response("لا يوجد اتصال بالإنترنت", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))));
    return;
  }
  // باقي الملفات (خطوط، مكتبات، أيقونات): من الذاكرة فورًا ثم تحديثها في الخلفية
  e.respondWith(
    caches.match(r).then((hit) => {
      const net = fetch(r).then((res) => {
        if (res && (res.ok || res.type === "opaque")) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(r, cp)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }));
});
