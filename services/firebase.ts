import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut as firebaseSignOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// Hardcoded Configuration provided by user
const firebaseConfig = {
  apiKey: "AIzaSyAc95KQ8qyZOEbanApkN2QhpESCwNnOA04",
  authDomain: "gemgroupchat.firebaseapp.com",
  projectId: "gemgroupchat",
  storageBucket: "gemgroupchat.firebasestorage.app",
  messagingSenderId: "596510108307",
  appId: "1:596510108307:web:e65a22c2da81f3ffdcfb66",
  measurementId: "G-HXJ7W1G5R0"
};

let app;
let auth: any;
let db: any;
let googleProvider: any;
let isConfigured = false;

// --- Mock Data for Offline Guest Mode ---
let mockUser: any = null;
const authListeners: ((user: any) => void)[] = [];
// Structure: { [groupId]: { details: {}, messages: [] } }
const mockDb: Record<string, any> = {};
const mockListeners: Record<string, Function[]> = {};

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
    isConfigured = true;
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
}

export { auth, db, googleProvider, isConfigured };

// --- Internal Helper for Mock Updates ---
const notifyMockListeners = () => {
    authListeners.forEach(cb => cb(mockUser));
};

// --- Auth Functions ---

export const subscribeToAuth = (callback: (user: any) => void) => {
  if (isConfigured && auth) {
    return onAuthStateChanged(auth, callback);
  } else {
    // Fallback for offline mode subscription
    authListeners.push(callback);
    callback(mockUser);
    return () => {
        const idx = authListeners.indexOf(callback);
        if (idx > -1) authListeners.splice(idx, 1);
    };
  }
};

export const signInWithGoogle = async () => {
  if (!isConfigured || !auth) {
    alert("Firebase is not initialized. Please check the hardcoded configuration.");
    return false;
  }
  try {
    await signInWithPopup(auth, googleProvider);
    return true;
  } catch (error: any) {
    console.error("Error signing in with Google", error);
    if (error.code === 'auth/unauthorized-domain') {
        alert("Domain Error: This domain is not authorized in Firebase Console.");
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
    } else if (mockUser) {
        mockUser = { ...mockUser, displayName: name };
        notifyMockListeners();
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
      alert(`Guest Sign-In failed: ${error.message}`);
    }
  } else {
      // Offline Guest Mode
      console.log("Entering Offline Guest Mode");
      mockUser = {
          uid: 'guest-offline-' + Date.now(),
          displayName: name || 'Guest',
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
    mockUser = null;
    notifyMockListeners();
  }
};

// --- Group & Message Functions ---

export const createGroup = async (name: string, creatorId: string): Promise<string> => {
  // Offline Mode
  if (!isConfigured || !db) {
      const mockId = 'offline-group-' + Date.now();
      mockDb[mockId] = {
          details: { id: mockId, name, createdBy: creatorId, createdAt: Date.now(), members: [creatorId] },
          messages: []
      };
      return mockId;
  }
  
  // Real Mode
  const groupRef = await addDoc(collection(db, 'groups'), {
    name,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [creatorId]
  });
  return groupRef.id;
};

export const getGroupDetails = async (groupId: string) => {
  // Offline Mode
  if (!isConfigured || !db) {
      return mockDb[groupId]?.details || null;
  }

  // Real Mode
  const docRef = doc(db, 'groups', groupId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
};

// Real-time Message Subscription
export const subscribeToMessages = (groupId: string, callback: (messages: any[]) => void) => {
  // Offline Mode
  if (!isConfigured || !db) {
      if (!mockListeners[groupId]) mockListeners[groupId] = [];
      mockListeners[groupId].push(callback);
      // Send initial data
      callback(mockDb[groupId]?.messages || []);
      return () => {
          const idx = mockListeners[groupId].indexOf(callback);
          if (idx > -1) mockListeners[groupId].splice(idx, 1);
      };
  }

  // Real Mode
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
  const msgData = { ...message, timestamp: Date.now() };

  // Offline Mode
  if (!isConfigured || !db) {
      if (mockDb[groupId]) {
          mockDb[groupId].messages.push(msgData);
          // Notify listeners
          mockListeners[groupId]?.forEach(cb => cb(mockDb[groupId].messages));
      }
      return;
  }
  
  // Real Mode
  await setDoc(doc(db, 'groups', groupId, 'messages', message.id), msgData);
};

// Update Message
export const updateMessage = async (groupId: string, messageId: string, updates: any) => {
  // Offline Mode
  if (!isConfigured || !db) {
      if (mockDb[groupId]) {
          const msg = mockDb[groupId].messages.find((m: any) => m.id === messageId);
          if (msg) {
              Object.assign(msg, updates);
              mockListeners[groupId]?.forEach(cb => cb(mockDb[groupId].messages));
          }
      }
      return;
  }

  // Real Mode
  const msgRef = doc(db, 'groups', groupId, 'messages', messageId);
  await updateDoc(msgRef, updates);
};