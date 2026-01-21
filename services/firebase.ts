import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut as firebaseSignOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc, getDocs, increment } from 'firebase/firestore';

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
// Mock Token Usage
let mockTokenUsage: Record<string, any> = { key_0: 0, key_1: 0, key_2: 0, key_3: 0, activeKeyIndex: 0 };
let mockUsageListener: ((data: any) => void) | null = null;
// Mock Canvas
const mockCanvasDb: Record<string, any> = {};
const mockCanvasListeners: Record<string, Function[]> = {};

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

// --- Token Usage Functions ---

export const subscribeToTokenUsage = (callback: (data: any) => void) => {
    if (!isConfigured || !db) {
        mockUsageListener = callback;
        callback(mockTokenUsage);
        return () => { mockUsageListener = null; };
    }
    
    const docRef = doc(db, 'system', 'token_usage');
    return onSnapshot(docRef, (doc) => {
        if (doc.exists()) callback(doc.data());
        else callback({});
    });
};

export const updateTokenUsage = async (keyIndex: number, totalTokens: number) => {
    const keyField = `key_${keyIndex}`;
    
    if (!isConfigured || !db) {
        mockTokenUsage[keyField] = (mockTokenUsage[keyField] || 0) + totalTokens;
        mockTokenUsage.activeKeyIndex = keyIndex;
        if (mockUsageListener) mockUsageListener({ ...mockTokenUsage });
        return;
    }

    const docRef = doc(db, 'system', 'token_usage');
    // Using setDoc with merge to ensure document exists, using increment for atomic updates
    await setDoc(docRef, {
        [keyField]: increment(totalTokens),
        activeKeyIndex: keyIndex
    }, { merge: true });
};

// --- Group & Message Functions ---

export const checkGroupNameTaken = async (name: string): Promise<boolean> => {
    const normalizedName = name.trim();
    
    // Offline Mode Check
    if (!isConfigured || !db) {
        return Object.values(mockDb).some((g: any) => 
            g.details.name.toLowerCase() === normalizedName.toLowerCase()
        );
    }

    // Real Mode Check
    const q = query(collection(db, 'groups'), where('name', '==', normalizedName));
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
};

export const createGroup = async (name: string, creatorId: string): Promise<string> => {
  const normalizedName = name.trim();

  // Note: We check specifically in GroupModal, but good to have safety here
  const exists = await checkGroupNameTaken(normalizedName);
  if (exists) {
      throw new Error("Group name is already taken");
  }

  // Offline Mode
  if (!isConfigured || !db) {
      const mockId = 'offline-group-' + Date.now();
      mockDb[mockId] = {
          details: { id: mockId, name: normalizedName, createdBy: creatorId, createdAt: Date.now(), members: [creatorId] },
          messages: []
      };
      // Init Canvas for group
      mockCanvasDb[mockId] = { html: '', css: '', js: '', lastUpdated: Date.now(), terminalOutput: [] };
      return mockId;
  }
  
  // Real Mode
  const groupRef = await addDoc(collection(db, 'groups'), {
    name: normalizedName,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [creatorId]
  });
  // Init Canvas State
  await setDoc(doc(db, 'groups', groupRef.id, 'canvas', 'current'), {
      html: '',
      css: '',
      js: '',
      lastUpdated: Date.now(),
      terminalOutput: []
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

// --- Canvas Functions ---

export const subscribeToCanvas = (groupId: string, callback: (data: any) => void) => {
    if (!isConfigured || !db) {
        if (!mockCanvasListeners[groupId]) mockCanvasListeners[groupId] = [];
        mockCanvasListeners[groupId].push(callback);
        callback(mockCanvasDb[groupId] || { html: '', css: '', js: '', terminalOutput: [] });
        return () => {};
    }

    const docRef = doc(db, 'groups', groupId, 'canvas', 'current');
    return onSnapshot(docRef, (doc) => {
        if (doc.exists()) callback(doc.data());
        else callback({ html: '', css: '', js: '' });
    });
};

export const updateCanvas = async (groupId: string, updates: any) => {
    const data = { ...updates, lastUpdated: Date.now() };

    if (!isConfigured || !db) {
        mockCanvasDb[groupId] = { ...mockCanvasDb[groupId], ...data };
        mockCanvasListeners[groupId]?.forEach(cb => cb(mockCanvasDb[groupId]));
        return;
    }

    const docRef = doc(db, 'groups', groupId, 'canvas', 'current');
    await setDoc(docRef, data, { merge: true });
};