// Sparar appens filer så att den startar utan internet. chess.com hämtas alltid från nätet.
const VERSION = 'schackreview-10';
const FILES = ['./', 'index.html', 'style.css', 'manifest.json', 'js/app.js', 'js/icons.js', 'js/pc.js', 'js/chess.js', 'js/engine.js',
  'js/analysis.js', 'js/coach.js', 'js/game.js', 'js/sf.js', 'js/store.js', 'js/stats.js', 'js/train.js', 'js/coach_play.js', 'js/coach_lines.js', 'js/stockfish-18-lite-single.js', 'js/stockfish-18-lite-single.wasm',
  'data/book.json', 'data/training.json', 'data/puzzles.json', 'data/themes.json', 'icons/icon-180.png', 'icons/icon-192.png',
  ...['p', 'n', 'b', 'r', 'q', 'k'].flatMap(t => [`pieces/${t}l.svg`, `pieces/${t}d.svg`])];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // Sidan, koden och stilen: nätet först och alltid frågat mot servern, så att nya versioner syns direkt.
  // Bilder, data och motorn: från telefonens minne direkt (de byts bara ut när VERSION ändras), så att
  // pjäserna inte hämtas om och dyker upp långsamt.
  const fresh = e.request.mode === 'navigate' || /\.(js|css|html|json)$/.test(url.pathname) && !url.pathname.includes('/data/');
  if (!fresh) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    })));
    return;
  }
  e.respondWith(fetch(new Request(e.request.url, { cache: 'no-cache' })).then(r => {
    const copy = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
