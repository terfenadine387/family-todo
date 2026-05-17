importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "←StarChatと同じ値",
  authDomain: "hoshinos-first-project.firebaseapp.com",
  projectId: "hoshinos-first-project",
  storageBucket: "hoshinos-first-project.appspot.com",
  messagingSenderId: "←同じ値",
  appId: "←同じ値",
});

const messaging = firebase.messaging();

// バックグラウンド通知受信
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
  });
});