importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAG4u2sIhKXnfNCiFRkjKDp-Xsv-lTyjHg",
  authDomain: "hoshinos-first-project.firebaseapp.com",
  projectId: "hoshinos-first-project",
  storageBucket: "hoshinos-first-project.appspot.com",
  messagingSenderId: "885062187812",
  appId: "1:885062187812:web:18186f3fa1abf6d0b911b1",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // family-todo宛の通知だけ処理する
  if (!payload.fcmOptions?.link?.includes("family-todo")) return;

  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    data: { url: payload.fcmOptions.link },
  });
});