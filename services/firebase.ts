import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut as firebaseSignOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

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

// --- Mock Data Store for Preview Mode ---
let mockUser: any = null;
const authListeners: ((user: any) => void)[] = [];
// Mock DB Structure: { groupId: { details: {}, messages: [] } }
const mockDb: Record<string, any> = {}; 
const groupListeners: Record<string, Function[]> = {};

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

// --- Auth Functions ---

const notifyMockListeners = () => {
  authListeners.forEach(listener => listener(mockUser));
};

export const subscribeToAuth = (callback: (user: any) => void) => {
  if (isConfigured && auth) {
    return onAuthStateChanged(auth, callback);
  } else {
    callback(mockUser);
    authListeners.push(callback);
    return () => {
      const index = authListeners.indexOf(callback);
      if (index > -1) authListeners.splice(index, 1);
    };
  }
};

export const signInWithGoogle = async () => {
  if (!isConfigured || !auth) {
    // Return false to indicate that the UI should handle the mock flow
    return false;
  }
  try {
    await signInWithPopup(auth, googleProvider);
    return true;
  } catch (error) {
    console.error("Error signing in with Google", error);
    return false;
  }
};

export const simulateGoogleSignIn = (email: string, name: string) => {
    mockUser = {
      uid: 'mock-google-' + Date.now(),
      displayName: name,
      email: email,
      photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
      isAnonymous: false
    };
    notifyMockListeners();
};

export const updateUserProfile = async (name: string) => {
    if (isConfigured && auth && auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: name });
        // Force refresh
        auth.updateCurrentUser(auth.currentUser); 
    } else if (mockUser) {
        mockUser = { ...mockUser, displayName: name };
        notifyMockListeners();
    }
}

export const signInGuest = async () => {
  // Prompt for name to ensure "Before every single user prompt, there should be the name" requirement
  const name = prompt("Enter your display name for this session:", "Guest");
  if (name === null) return; // Cancelled

  if (isConfigured && auth) {
    try {
      const result = await signInAnonymously(auth);
      // Try to update profile with name (best effort for anonymous)
      if (result.user) {
          await updateProfile(result.user, { displayName: name || 'Guest' }).catch(() => {});
      }
    } catch (error) {
      console.error("Error signing in anonymously", error);
    }
  } else {
    mockUser = {
      uid: 'guest-' + Date.now().toString().slice(-6),
      displayName: name || 'Guest User',
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
  if (!isConfigured || !db) {
    const mockId = 'mock-group-' + Date.now();
    mockDb[mockId] = {
        details: {
            id: mockId,
            name,
            createdBy: creatorId,
            createdAt: Date.now(),
            members: [creatorId]
        },
        messages: []
    };
    return mockId;
  }
  
  const groupRef = await addDoc(collection(db, 'groups'), {
    name,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [creatorId]
  });
  return groupRef.id;
};

export const getGroupDetails = async (groupId: string) => {
  if (!isConfigured || !db) {
    return mockDb[groupId]?.details || null;
  }
  const docRef = doc(db, 'groups', groupId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
};

// Real-time Message Subscription
export const subscribeToMessages = (groupId: string, callback: (messages: any[]) => void) => {
  if (!isConfigured || !db) {
    // Mock Subscription
    if (!groupListeners[groupId]) groupListeners[groupId] = [];
    groupListeners[groupId].push(callback);
    
    // Initial Call
    const messages = mockDb[groupId]?.messages || [];
    callback(messages);

    return () => {
        const idx = groupListeners[groupId]?.indexOf(callback);
        if (idx !== undefined && idx > -1) groupListeners[groupId].splice(idx, 1);
    };
  }

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
  const msgData = {
      ...message,
      timestamp: Date.now() // Ensure server timestamp logic if needed
  };

  if (!isConfigured || !db) {
    // Mock Send
    if (!mockDb[groupId]) return;
    mockDb[groupId].messages.push(msgData);
    // Notify listeners
    groupListeners[groupId]?.forEach(cb => cb(mockDb[groupId].messages));
    return;
  }

  await setDoc(doc(db, 'groups', groupId, 'messages', message.id), msgData);
};

// Update Message (for streaming chunks)
export const updateMessage = async (groupId: string, messageId: string, updates: any) => {
  if (!isConfigured || !db) {
     if (!mockDb[groupId]) return;
     const msg = mockDb[groupId].messages.find((m: any) => m.id === messageId);
     if (msg) {
         Object.assign(msg, updates);
         groupListeners[groupId]?.forEach(cb => cb(mockDb[groupId].messages));
     }
     return;
  }

  const msgRef = doc(db, 'groups', groupId, 'messages', messageId);
  await updateDoc(msgRef, updates);
};