/* ============================================================
   Service worker — installation de l'application
   ------------------------------------------------------------
   Principe retenu, important pour un usage réglementaire :
     • la coque de l'application (page, icônes) est mise en cache,
       ce qui permet l'ouverture hors connexion ;
     • AUCUNE réponse de /api/ n'est jamais mise en cache : les
       données de validation affichées proviennent toujours du
       serveur, jamais d'une copie qui pourrait être périmée.
   ============================================================ */

const VERSION = 'validation-v3';
const COQUE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icone-192.png',
  '/icone-512.png'
];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(COQUE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys()
      .then(noms => Promise.all(noms.filter(n => n !== VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evt => {
  const req = evt.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Les appels au serveur ne passent jamais par le cache. */
  if (url.pathname.startsWith('/api/')) return;

  /* La page : le réseau d'abord, afin d'avoir toujours la dernière
     version ; le cache sert uniquement de secours hors connexion. */
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    evt.respondWith(
      fetch(req)
        .then(rep => {
          const copie = rep.clone();
          caches.open(VERSION).then(c => c.put('/index.html', copie)).catch(() => {});
          return rep;
        })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }

  /* Ressources statiques : le cache d'abord. */
  evt.respondWith(
    caches.match(req).then(enCache => {
      if (enCache) return enCache;
      return fetch(req).then(rep => {
        if (rep && rep.status === 200 && rep.type === 'basic') {
          const copie = rep.clone();
          caches.open(VERSION).then(c => c.put(req, copie)).catch(() => {});
        }
        return rep;
      });
    })
  );
});

/* Permet à la page de déclencher la mise à jour sans rechargement manuel */
self.addEventListener('message', evt => {
  if (evt.data === 'majmaintenant') self.skipWaiting();
});
