// Service worker: guarda la app en el teléfono para que abra sin señal.
const CACHE = 'misvisitas-v3';
const ARCHIVOS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/chart.umd.min.js', 'vendor/xlsx.full.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // la sincronización con Google va directo
  if (u.pathname.endsWith('historico.json')) return; // siempre fresco
  // Caché primero (abre al instante aunque la señal sea mala) y se actualiza en segundo plano
  e.respondWith(caches.open(CACHE).then(async (ca) => {
    const hit = await ca.match(e.request, { ignoreSearch: true });
    const red = fetch(e.request).then((r) => { if (r.ok) ca.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await red) || ca.match('index.html');
  }));
});
