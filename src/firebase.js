import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyAG4u2sIhKXnfNCiFRkjKDp-Xsv-lTyjHg",
  authDomain:        "hoshinos-first-project.firebaseapp.com",
  projectId:         "hoshinos-first-project",
  storageBucket:     "hoshinos-first-project.appspot.com",
  messagingSenderId: "885062187812",
  appId:             "1:885062187812:web:18186f3fa1abf6d0b911b1",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;