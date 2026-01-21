import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth';
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
let isConfigured = false;

// Mock Auth State for Preview/Skip Mode when Firebase is missing
let mockUser: any = null;
const authListeners: ((user: any) => void)[] = [];

try {
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
    isConfigured = true;
  } else {
    console.warn("Firebase config missing. Running in Mock/Preview mode.");
  }
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
}

export { auth, db, googleProvider, isConfigured };

// Notify mock listeners
const notifyMockListeners = () => {
  authListeners.forEach(listener => listener(mockUser));
};

// Unified Auth Subscription (Handles both Real Firebase and Mock)
export const subscribeToAuth = (callback: (user: any) => void) => {
  if (isConfigured && auth) {
    return onAuthStateChanged(auth, callback);
  } else {
    // Immediate callback with current mock state
    callback(mockUser);
    // Subscribe
    authListeners.push(callback);
    // Unsubscribe function
    return () => {
      const index = authListeners.indexOf(callback);
      if (index > -1) authListeners.splice(index, 1);
    };
  }
};

export const signInWithGoogle = async () => {
  if (!isConfigured || !auth) {
    alert("Google Sign-In requires Firebase configuration. Use 'Skip' to preview.");
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Error signing in with Google", error);
  }
};

export const signInGuest = async () => {
  if (isConfigured && auth) {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error("Error signing in anonymously", error);
    }
  } else {
    // Mock Guest Login
    mockUser = {
      uid: 'guest-' + Date.now().toString().slice(-6),
      displayName: 'Guest User',
      isAnonymous: true,
      photoURL: null
    };
    notifyMockListeners();
  }
};

export const signOut = async () => {
  if (isConfigured && auth) {
    await firebaseSignOut(auth);
  } else {
    // Mock Sign Out
    mockUser = null;
    notifyMockListeners();
  }
};

// Firestore Helpers for Groups
export const createGroup = async (name: string, creatorId: string): Promise<string> => {
  if (!isConfigured || !db) {
    // Return a mock ID for UI preview
    console.warn("Database not configured. Using Mock Group ID.");
    return 'mock-group-' + Date.now();
  }
  
  const groupRef = await addDoc(collection(db, 'groups'), {
    name,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [creatorId]
  });
  return groupRef.id;
};

export const joinGroup = async (groupId: string, userId: string) => {
  if (!isConfigured || !db) return;
  // meaningful logic would go here to add user to members array
};

export const getGroupDetails = async (groupId: string) => {
  if (!isConfigured || !db) {
    // Return mock details if in preview mode
    if (groupId.startsWith('mock-group')) {
        return {
            id: groupId,
            name: 'Mock Group Session',
            createdBy: 'mock-user',
            createdAt: Date.now(),
            members: []
        };
    }
    return null;
  }
  const docRef = doc(db, 'groups', groupId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
};