// sw.js — MotoStock Service Worker v2.3
// Cache strategy: Network first para API, Cache first para assets estáticos

const CACHE_NAME   = 'motostock-v2.4';
const STATIC_CACHE = 'motostock-static-v2.4';

// Assets para cache estático (shell da aplicação)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API: Network first, fila offline se falhar
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Assets estáticos: Cache first
  if (request.method === 'GET') {
    event.respondWith(cacheFirst(request));
  }
});

// ── Estratégias de Cache ──────────────────────────────────────────────────────

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Cache apenas GETs bem-sucedidos
    if (request.method === 'GET' && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Resposta offline padrão para API
    return new Response(JSON.stringify({
      data: null,
      error: { message: 'Sem conexão. Dados offline podem estar desatualizados.' },
      offline: true
    }), { headers: { 'Content-Type': 'application/json' } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Fallback para index.html em modo SPA
    const fallback = await caches.match('/index.html');
    return fallback || new Response('Offline', { status: 503 });
  }
}

// ── Background Sync (fila de operações offline) ───────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending') {
    event.waitUntil(syncPendingOperations());
  }
});

async function syncPendingOperations() {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_COMPLETE' });
    });
  } catch(e) {
    console.error('[SW] Sync error:', e);
  }
}
