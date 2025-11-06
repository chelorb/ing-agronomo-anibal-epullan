// ✅ service-worker.js corregido y compatible con GitHub Pages

const CACHE_NAME = 'registro-cache-v2';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './logo-192.png',
  './logo-512.png'
];

// Instalación del SW y precacheo de archivos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache).catch(err => {
        console.error('Error al cachear archivos:', err);
      });
    })
  );
});

// Activación: elimina caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => key !== CACHE_NAME && caches.delete(key))
      )
    )
  );
});

// Fetch: intenta servir desde cache y si falla, va a la red
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return (
        response ||
        fetch(event.request).catch(() =>
          new Response('Sin conexión y sin cache disponible.', {
            status: 503,
            statusText: 'Offline',
          })
        )
      );
    })
  );
});
