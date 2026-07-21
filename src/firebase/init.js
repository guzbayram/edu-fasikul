import { initializeApp } from 'firebase/app';
import {
  getFirestore, doc, setDoc, getDoc, collection, getDocs,
  deleteDoc, updateDoc, onSnapshot
} from 'firebase/firestore';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCbpnmiiHY94r9qTUUFgGQNsfTT8Q3Y0XU",
  authDomain: "edu-fasikul.firebaseapp.com",
  projectId: "edu-fasikul",
  storageBucket: "edu-fasikul.firebasestorage.app",
  messagingSenderId: "1082589230841",
  appId: "1:1082589230841:web:0688efea10201ac2d71428"
};

const app = initializeApp(firebaseConfig);
const creatorApp = initializeApp(firebaseConfig, 'EduFasikulUserCreator');

export const db = getFirestore(app);
export const auth = getAuth(app);
export const creatorAuth = getAuth(creatorApp);

// Firestore API fonksiyonları
export { doc, setDoc, getDoc, collection, getDocs, deleteDoc, updateDoc, onSnapshot };

// Auth API fonksiyonları
export {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail
};

// Geriye dönük uyumluluk için window globals — Faz 3'te kaldırılacak
window._db = db;
window._auth = auth;
window._authCreator = creatorAuth;
window._fsDoc = doc;
window._fsSetDoc = setDoc;
window._fsGetDoc = getDoc;
window._fsCollection = collection;
window._fsGetDocs = getDocs;
window._fsDeleteDoc = deleteDoc;
window._fsUpdateDoc = updateDoc;
window._fsOnSnapshot = onSnapshot;

window._authCreateUser = createUserWithEmailAndPassword;
window._authSignIn = signInWithEmailAndPassword;
window._authSignOut = signOut;
window._authOnStateChanged = onAuthStateChanged;
window._authUpdatePassword = updatePassword;
window._authSendPasswordReset = sendPasswordResetEmail;

window._firestoreReady = true;
window._authReady = true;
window.dispatchEvent(new Event('firestore-ready'));
window.dispatchEvent(new Event('auth-ready'));
