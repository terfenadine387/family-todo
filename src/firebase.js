// import { initializeApp } from "firebase/app";
// import { getFirestore } from "firebase/firestore";

// const firebaseConfig = {
//   apiKey:            "AIzaSyAG4u2sIhKXnfNCiFRkjKDp-Xsv-lTyjHg",
//   authDomain:        "hoshinos-first-project.firebaseapp.com",
//   projectId:         "hoshinos-first-project",
//   storageBucket:     "hoshinos-first-project.appspot.com",
//   messagingSenderId: "885062187812",
//   appId:             "1:885062187812:web:18186f3fa1abf6d0b911b1",
// };

// export const app = initializeApp(firebaseConfig);
// export const db = getFirestore(app);
// export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;