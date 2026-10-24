import type { FastifyInstance } from 'fastify'

export const worker = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Deliberately no fetch handler: never cache authenticated chats, APIs or credentials.
self.addEventListener('push', event => {
  let data;
  try { data = event.data.json(); } catch { return; }
  if (!data || typeof data !== 'object' || !/^[0-9a-f-]{36}$/.test(data.conversationId)) return;
  const messages = { completed: 'El chat ha terminado.', error: 'Un chat necesita atención por un error.', approval: 'Un chat espera tu aprobación.' };
  if (!Object.prototype.hasOwnProperty.call(messages, data.kind)) return;
  event.waitUntil(self.registration.showNotification('Alfred', {
    body: messages[data.kind], tag: 'alfred-' + data.conversationId,
    data: { conversationId: data.conversationId }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.conversationId;
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  const url = new URL('/?conversation=' + encodeURIComponent(id), self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.navigate(url);
      await client.focus();
      return;
    }
    await self.clients.openWindow(url);
  })());
});
`
export function pwaRoutes(app: FastifyInstance) {
  app.get('/sw.js', async (_request, reply) => reply.header('Cache-Control', 'no-cache').type('application/javascript').send(worker))
  app.get('/manifest.webmanifest', async (_request, reply) => reply.type('application/manifest+json').send({
    id: '/', name: 'Alfred Workspace', short_name: 'Alfred', start_url: '/', scope: '/',
    display: 'standalone', background_color: '#263c32', theme_color: '#263c32',
    icons: [{ src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }))
  app.get('/pwa-icon.svg', async (_request, reply) => reply.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#263c32"/><text x="100" y="350" font-size="320" font-family="sans-serif" fill="white">a·</text></svg>'))
}
