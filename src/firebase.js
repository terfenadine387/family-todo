import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyAG4u2sIhKXnfNCiFRkjKDp-Xsv-lTyjHg",
  authDomain: "hoshinos-first-project.firebaseapp.com",
  projectId: "hoshinos-first-project",
  storageBucket: "hoshinos-first-project.firebasestorage.app",
  messagingSenderId: "885062187812",
  appId: "1:885062187812:web:18186f3fa1abf6d0b911b1",
  measurementId: "G-DYKG5EWCZP"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export let messaging = null;
isSupported().then((supported) => {
  if (supported) {
    messaging = getMessaging(app);
  }
}).catch(console.error);

// VAPIDキーは次のステップで取得します
export const VAPID_KEY = "d21gbvILGedJJ1HPGOtuoASYbbpnenJbtrpvprLwmiU";

export { getToken, onMessage };