/* Reminders (M10 §4–§5): loaded into the generated service worker (workbox importScripts).
 * A push carries {title, body, url, tag}; tapping the notification opens the event's link in an
 * open Happow window if there is one, else a new one. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'Happow' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Happow', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) return win.navigate(url).then((w) => (w || win).focus());
      return self.clients.openWindow(url);
    }),
  );
});
