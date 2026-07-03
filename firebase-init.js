// ══════════════════════════════════════════════════════════════════════════
// MICS IN MOTION — Firebase Init
// ══════════════════════════════════════════════════════════════════════════
// 1) Gehe zu https://console.firebase.google.com → "Projekt hinzufügen"
//    (kostenlos, kein Kreditkarte nötig für Spark-Plan)
// 2) In deinem neuen Projekt: Build → Authentication → "Get started"
//    → Sign-in method → "E-Mail/Passwort" aktivieren
// 3) Build → Firestore Database → "Create database" → Production mode
//    → Region z.B. eur3 (Europe)
// 4) Danach in Firestore → Rules → folgendes einfügen & "Publish":
//
//    rules_version = '2';
//    service cloud.firestore {
//      match /databases/{database}/documents {
//        match /rankings/{userId} {
//          allow read: if true;
//          allow write: if request.auth != null && request.auth.uid == userId;
//          match /lists/{listType} {
//            allow read: if true;
//            allow write: if request.auth != null && request.auth.uid == userId;
//          }
//        }
//      }
//    }
//
// 5) Projekteinstellungen (Zahnrad oben links) → "Deine Apps" → Web-App (</>)
//    hinzufügen → den firebaseConfig-Block kopieren und unten einfügen.
// ══════════════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── HIER DEINE FIREBASE CONFIG EINFÜGEN ───────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDX4WrluRaT9nESCMLaG0FfZsGLQWgujaA",
  authDomain: "mim-idp-rankings.firebaseapp.com",
  projectId: "mim-idp-rankings",
  storageBucket: "mim-idp-rankings.firebasestorage.app",
  messagingSenderId: "1057503302309",
  appId: "1:1057503302309:web:0701fa023ad06bcd48334c"
};
// ────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

// Erzeugt aus einem Benutzernamen eine interne Pseudo-E-Mail für Firebase Auth
// (Firebase Auth braucht technisch ein E-Mail-Format, die Nutzer sehen/tippen nur den Benutzernamen)
function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '') + "@mimhub.local";
}

// Verfügbare Ranking-Typen — jeder Nutzer hat pro Typ eine eigene Liste
export const LIST_TYPES = ['dynasty', 'redraft', 'rookie'];
// Jede Liste ist wiederum in drei Positions-Boards unterteilt
export const POSITIONS = ['DL', 'LB', 'DB'];
const emptyBoardObj = () => ({ inbox: [], t1: [], t2: [], t3: [], t4: [], t5: [], t6: [] });
const emptyListDoc = () => ({
  boards: { DL: emptyBoardObj(), LB: emptyBoardObj(), DB: emptyBoardObj() },
  updatedAt: Date.now()
});

// Nur für den Admin gedacht (siehe admin.html) — legt einen festen Account
// samt drei leeren Ranking-Listen (Dynasty/Redraft/Rookie), je mit drei
// Positions-Boards (DL/LB/DB), an.
// Hinweis: Firebase meldet den Ersteller nach dem Anlegen automatisch als neuen
// User an; admin.html loggt danach automatisch wieder aus.
export async function createFixedUser(username, password, displayName) {
  const email = usernameToEmail(username);
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await setDoc(doc(db, "rankings", cred.user.uid), { displayName, updatedAt: Date.now() });
  for (const listType of LIST_TYPES) {
    await setDoc(doc(db, "rankings", cred.user.uid, "lists", listType), emptyListDoc());
  }
  return cred.user;
}

export async function loginUser(username, password) {
  const email = usernameToEmail(username);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export async function loadBoard(userId, listType, positionTag) {
  const snap = await getDoc(doc(db, "rankings", userId, "lists", listType));
  if (snap.exists()) return snap.data()?.boards?.[positionTag] || null;
  return null;
}

// Speichert NUR das Board der übergebenen Position (DL/LB/DB) — die anderen
// beiden Positions-Boards im selben Listen-Dokument bleiben durch den
// nested merge unangetastet.
export async function saveBoard(userId, listType, positionTag, board) {
  await setDoc(doc(db, "rankings", userId, "lists", listType), {
    boards: { [positionTag]: board },
    updatedAt: Date.now()
  }, { merge: true });
}

// Live-Listener auf eine gesamte Liste (userId + Typ) — liefert alle drei
// Positions-Boards zusammen, damit man beim Wechseln des Positions-Tabs
// nicht neu abonnieren muss. Gibt eine unsubscribe-Funktion zurück.
export function watchBoard(userId, listType, cb) {
  return onSnapshot(doc(db, "rankings", userId, "lists", listType), snap => {
    cb(snap.exists() ? snap.data() : null);
  });
}

export async function listAllRankings() {
  const snap = await getDocs(collection(db, "rankings"));
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  return out;
}
