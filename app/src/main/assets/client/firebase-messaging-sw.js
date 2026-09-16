/**
 * BUYERO FIREBASE CLOUD MESSAGING SERVICE WORKER (Client scoped)
 */
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyB82dHkvbZwYjG9cr7PQ-rLd48KKkyZmvA",
  authDomain: "buyero-68abd.firebaseapp.com",
  projectId: "buyero-68abd",
  storageBucket: "buyero-68abd.firebasestorage.app",
  messagingSenderId: "133729371654",
  appId: "1:133729371654:web:7d35b363dd94d2f90ca587",
  measurementId: "G-FXEYQKCYMK"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[Buyero Client SW] Background Push:', payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || 'Buyero Notification';
  const notificationBody = payload.notification?.body || payload.data?.body || 'You have a new notification!';
  const notificationIcon = payload.notification?.icon || payload.data?.icon || 'https://buyero-68abd.web.app/assets/icons/icon-192x192.png';
  const notificationImage = payload.notification?.image || payload.data?.image || payload.notification?.imageUrl || payload.data?.imageUrl;
  const targetUrl = payload.fcmOptions?.link || payload.data?.url || payload.data?.link || '/';

  const notificationOptions = {
    body: notificationBody,
    icon: notificationIcon,
    badge: 'https://buyero-68abd.web.app/assets/icons/icon-192x192.png',
    image: notificationImage || undefined,
    vibrate: [200, 100, 200],
    data: { url: targetUrl }
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destinationUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(destinationUrl) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(destinationUrl);
    })
  );
});
