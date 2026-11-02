// Caches the app shell so the UI opens instantly; data calls always go to the network.
// __VERSION__ is replaced by ServiceWorkerController with a hash of the files listed in SHELL: no manual bump.
const CACHE = 'expense-tracker-__VERSION__';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/lang.js', '/js/i18n.js', '/js/icons.js', '/js/select.js', '/js/features.js', '/js/tools.js', '/js/extras.js', '/js/profiles.js', '/icons/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname)) {
        return;
    }
    // Network first so updates show up; fall back to cache when offline.
    event.respondWith(
        fetch(event.request)
            .then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(cache => cache.put(event.request, copy));
                return res;
            })
            .catch(() => caches.match(event.request)));
});
