// Sparar appens filer så att den startar utan internet. chess.com hämtas alltid från nätet.
const VERSION = 'schackreview-1';
const FILES = ['./', 'index.html', 'style.css', 'manifest.json', 'js/app.js', 'js/pc.js', 'js/chess.js', 'js/engine.js',
  'js/analysis.js', 'js/coach.js', 'js/game.js', 'js/sf.js', 'js/stockfish-18-lite-single.js', 'js/stockfish-18-lite-single.wasm',
  'data/book.json', 'icons/icon-180.png', 'icons/icon-192.png',
  ...['p', 'n', 'b', 'r', 'q', 'k'].flatMap(t => [`pieces/${t}l.png`, `pieces/${t}d.png`])];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Nätet först, så att nya versioner syns direkt; sparad kopia när det saknas internet.
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
