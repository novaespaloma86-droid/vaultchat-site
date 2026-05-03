importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDyJNu9HnyCIUJYTEJ4KoTeORDVMTXPyzA",
  authDomain: "vaultchat-dce0b.firebaseapp.com",
  projectId: "vaultchat-dce0b",
  storageBucket: "vaultchat-dce0b.firebasestorage.app",
  messagingSenderId: "936113564920",
  appId: "1:936113564920:web:0667849eadf3cdb4b19f0d"
});

const messaging = firebase.messaging();

// Notificação em background (quando app está fechado)
messaging.onBackgroundMessage((payload) => {
  console.log('[VaultChat] Notificação em background:', payload);

  const { title, body, icon } = payload.notification || {};

  self.registration.showNotification(title || '🔒 VaultChat', {
    body: body || 'Nova mensagem segura',
    icon: icon || '/vaultchat-icon-1024.png',
    badge: '/vaultchat-icon-1024.png',
    vibrate: [200, 100, 200],
    tag: 'vaultchat-message',
    renotify: true,
    data: payload.data || {},
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'close', title: 'Fechar' }
    ]
  });
});

// Clique na notificação
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'close') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('vaultchat') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/chat.html');
    })
  );
});
