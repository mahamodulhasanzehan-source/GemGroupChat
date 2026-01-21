import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut as firebaseSignOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, doc, getDoc, setDoc } from 'firebase/firestore';

// Mapping Vercel/Screenshot Env Vars to Firebase Config
const firebaseConfig = {
  apiKey: process.env.GEMGROUPCHAT_KEY,
  authDomain: process.env.GEMGROUPCHAT_AUTH,
  projectId: process.env.GEMGROUPCHAT_ID,
  storageBucket: process.env.GEMGROUPCHAT_BUCKET,
  messagingSenderId: process.env.GEMGROUPCHAT_SENDER,
  appId: process.env.GEMGROUPCHAT_APP
};

let app;
let auth: any;
let db: any;
let googleProvider: any;

// Safely attempt to initialize Firebase
// This prevents the "Uncaught FirebaseError" that causes the white/black screen of death
// if environment variables are missing.
try {
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
  } else {
    console.warn("Firebase configuration is missing. App will enter configuration mode.");
  }
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
}

export { auth, db, googleProvider };

export const signInWithGoogle = async () => {
  if (!auth) {
    alert("Authentication is not configured. Please set up environment variables.");
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Error signing in with Google", error);
  }
};

export const signInGuest = async () => {
  if (!auth) {
    alert("Authentication is not configured. Please set up environment variables.");
    return;
  }
  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error("Error signing in anonymously", error);
  }
};

export const signOut = async () => {
  if (auth) {
    await firebaseSignOut(auth);
  }
};

// Firestore Helpers for Groups
export const createGroup = async (name: string, creatorId: string): Promise<string> => {
  if (!db) throw new Error("Database not initialized");
  
  const groupRef = await addDoc(collection(db, 'groups'), {
    name,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [creatorId]
  });
  return groupRef.id;
};

export const joinGroup = async (groupId: string, userId: string) => {
  if (!db) return;
  // meaningful logic would go here to add user to members array
  // keeping it simple for UI demo
};

export const getGroupDetails = async (groupId: string) => {
  if (!db) return null;
  const docRef = doc(db, 'groups', groupId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
};
