/* Firebase Cloud Messaging — background service worker.
   Handles push notifications when the app/tab is closed or in the background.
   Must live at the site root (/firebase-messaging-sw.js) so its scope covers the whole app. */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC9oJrhtVRE91_fF8FHEWXbcBJnY-916Zc",
  authDomain: "apni-dukan-b8e19.firebaseapp.com",
  projectId: "apni-dukan-b8e19",
  storageBucket: "apni-dukan-b8e19.firebasestorage.app",
  messagingSenderId: "723874285858",
  appId: "1:723874285858:web:42e670642150b873187d7b",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "🛍️ નવો ઓર્ડર આવ્યો!";
  const options = {
    body: (payload.notification && payload.notification.body) || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: (payload.data && payload.data.orderId) || "order",
  };
  self.registration.showNotification(title, options);
});

// Clicking the notification focuses/opens the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});
