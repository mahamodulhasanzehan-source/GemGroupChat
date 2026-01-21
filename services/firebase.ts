import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut as firebaseSignOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// 1. Strict Mapping based on your list
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
let missingKeys: string[] = [];

// 2. Validation
Object.entries(firebaseConfig).forEach(([key, value]) => {
    if (!value) {
        // Map back to the Env Var name for clarity
        const envName = key === 'apiKey' ? 'GEMGROUPCHAT_KEY' :
                        key === 'authDomain' ? 'GEMGROUPCHAT_AUTH' :
                        key === 'projectId' ? 'GEMGROUPCHAT_ID' :
                        key === 'storageBucket' ? 'GEMGROUPCHAT_BUCKET' :
                        key === 'messagingSenderId' ? 'GEMGROUPCHAT_SENDER' :
                        key === 'appId' ? 'GEMGROUPCHAT_APP' : key;
        missingKeys.push(envName);
    }
});

try {
  if (missingKeys.length === 0) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
    isConfigured = true;
  } else {
    console.warn("Firebase config missing keys:", missingKeys.join(", "));
  }
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
}

export { auth, db, googleProvider, isConfigured };

// --- Auth Functions ---

export const subscribeToAuth = (callback: (user: any) => void) => {
  if (isConfigured && auth) {
    return onAuthStateChanged(auth, callback);
  } else {
    callback(null);
    return () => {};
  }
};

export const signInWithGoogle = async () => {
  if (!isConfigured || !auth) {
    alert(`Firebase Configuration Error.\n\nMissing Environment Variables:\n${missingKeys.join('\n')}\n\nPlease check your Vercel Project Settings.`);
    return false;
  }
  try {
    await signInWithPopup(auth, googleProvider);
    return true;
  } catch (error: any) {
    console.error("Error signing in with Google", error);
    // If the error is related to domain/auth
    if (error.code === 'auth/unauthorized-domain') {
        alert("Domain Error: This domain is not authorized in Firebase Console.\n\nGo to Firebase Console -> Authentication -> Settings -> Authorized Domains and add this URL.");
    } else {
        alert(`Google Sign-In failed: ${error.message}`);
    }
    return false;
  }
};

export const updateUserProfile = async (name: string) => {
    if (isConfigured && auth && auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: name });
        auth.updateCurrentUser(auth.currentUser); 
    }
}

export const signInGuest = async () => {
  const name = prompt("Enter your display name for this session:", "Guest");
  if (name === null) return; 

  if (isConfigured && auth) {
    try {
      const result = await signInAnonymously(auth);
      if (result.user) {
          await updateProfile(result.user, { displayName: name || 'Guest' }).catch(() => {});
      }
    } catch (error: any) {
      console.error("Error signing in anonymously", error);
      alert(`Guest Sign-In failed: ${error.message}`);
    }
  } else {
      alert(`Cannot start Guest Session.\n\nMissing Environment Variables:\n${missingKeys.join('\n')}`);
  }
};

export const signOut = async () => {
  if (isConfigured && auth) {
    await firebaseSignOut(auth);
  }
};

// --- Group & Message Functions ---

export const createGroup = async (name: string, creatorId: string): Promise<string> => {
  if (!isConfigured || !db) throw new Error("Database not configured");
  
  const groupRef = await addDoc(collection(db, 'groups'), {
    name,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [creatorId]
  });
  return groupRef.id;
};

export const getGroupDetails = async (groupId: string) => {
  if (!isConfigured || !db) return null;
  const docRef = doc(db, 'groups', groupId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
};

// Real-time Message Subscription
export const subscribeToMessages = (groupId: string, callback: (messages: any[]) => void) => {
  if (!isConfigured || !db) return () => {};

  const q = query(
    collection(db, 'groups', groupId, 'messages'), 
    orderBy('timestamp', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(msgs);
  });
};

// Send Message
export const sendMessage = async (groupId: string, message: any) => {
  if (!isConfigured || !db) return;
  
  const msgData = {
      ...message,
      timestamp: Date.now()
  };
  await setDoc(doc(db, 'groups', groupId, 'messages', message.id), msgData);
};

// Update Message
export const updateMessage = async (groupId: string, messageId: string, updates: any) => {
  if (!isConfigured || !db) return;

  const msgRef = doc(db, 'groups', groupId, 'messages', messageId);
  await updateDoc(msgRef, updates);
};