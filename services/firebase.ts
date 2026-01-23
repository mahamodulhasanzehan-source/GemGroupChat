import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut as firebaseSignOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc, getDocs, increment, deleteDoc, writeBatch, limit, arrayUnion, arrayRemove } from 'firebase/firestore';

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
// New: User Chat Mock
const mockUserChatDb: Record<string, any[]> = {}; // { groupId: [msgs] }
const mockUserChatListeners: Record<string, Function[]> = {};

// Mock Token Usage
let mockTokenUsage: Record<string, any> = { key_0: 0, key_1: 0, key_2: 0, key_3: 0, activeKeyIndex: 0 };
let mockUsageListener: ((data: any) => void) | null = null;
// Mock Canvas
const mockCanvasDb: Record<string, any> = {};
const mockCanvasListeners: Record<string, Function[]> = {};
// Mock Presence
const mockPresenceDb: Record<string, any> = {};
const mockPresenceListeners: Record<string, Function[]> = {};
// Mock User Groups Listener
const mockUserGroupsListeners: ((groups: any) => void)[] = [];
// Mock System Config
let mockSystemConfig: any = { globalCooldownUntil: 0 };

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

const notifyMockGroupListeners = () => {
    // Basic mock implementation: return all groups for now
    if (mockUserGroupsListeners.length > 0) {
        const groups = Object.values(mockDb).map((g: any) => g.details);
        mockUserGroupsListeners.forEach(cb => cb(groups));
    }
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
    throw new Error("Firebase not initialized");
  }
  try {
    // Using signInWithPopup is more reliable for 3rd party previews than Redirect
    // but may be blocked by browsers. UI handles the "popup-blocked" error.
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    console.error("Error initiating Google Sign-In", error);
    if (error.code === 'auth/unauthorized-domain') {
        alert("Domain Error: This domain is not authorized in Firebase Console.");
    }
    throw error; // Propagate to UI
  }
};

export const updateUserProfile = async (updates: { displayName?: string, photoURL?: string }) => {
    if (isConfigured && auth && auth.currentUser) {
        await updateProfile(auth.currentUser, updates);
        auth.updateCurrentUser(auth.currentUser); 
    } else if (mockUser) {
        mockUser = { ...mockUser, ...updates };
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

// --- Token Usage & System Config Functions ---

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
    // This handles the requirement: "Save usage data to Firestore to track totals across sessions."
    await setDoc(docRef, {
        [keyField]: increment(totalTokens),
        activeKeyIndex: keyIndex
    }, { merge: true });
};

// Get Global Cooldown Status
export const getSystemConfig = async () => {
    if (!isConfigured || !db) {
        return mockSystemConfig;
    }
    const docRef = doc(db, 'system', 'config');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return docSnap.data();
    }
    return { globalCooldownUntil: 0 };
};

// Set Global Cooldown
export const setSystemCooldown = async (untilTimestamp: number) => {
    if (!isConfigured || !db) {
        mockSystemConfig.globalCooldownUntil = untilTimestamp;
        return;
    }
    const docRef = doc(db, 'system', 'config');
    await setDoc(docRef, { globalCooldownUntil: untilTimestamp }, { merge: true });
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

export const getAllPublicGroups = async () => {
    // Offline Mode
    if (!isConfigured || !db) {
        const groups = Object.values(mockDb).map((g: any) => g.details);
        return groups.sort((a: any, b: any) => a.name.localeCompare(b.name));
    }

    // Real Mode
    // We limit to 100 to prevent overloading, sorted alphabetically
    const q = query(collection(db, 'groups'), orderBy('name'), limit(100));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
          details: { 
              id: mockId, 
              name: normalizedName, 
              createdBy: creatorId, 
              createdAt: Date.now(), 
              members: [creatorId], 
              processingMessageId: null, 
              isCallActive: false,
              callStartedBy: null,
              callParticipants: []
          },
          messages: []
      };
      // Init Canvas for group
      mockCanvasDb[mockId] = { html: '', css: '', js: '', lastUpdated: Date.now(), terminalOutput: [] };
      notifyMockGroupListeners();
      return mockId;
  }
  
  // Real Mode
  const groupRef = await addDoc(collection(db, 'groups'), {
    name: normalizedName,
    createdBy: creatorId,
    createdAt: Date.now(),
    members: [creatorId],
    processingMessageId: null,
    isCallActive: false,
    callStartedBy: null,
    callParticipants: []
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

export const joinGroup = async (groupId: string, userId: string) => {
    if (!isConfigured || !db) {
        if (mockDb[groupId] && !mockDb[groupId].details.members.includes(userId)) {
            mockDb[groupId].details.members.push(userId);
            notifyMockGroupListeners();
        }
        return;
    }

    const groupRef = doc(db, 'groups', groupId);
    await updateDoc(groupRef, {
        members: arrayUnion(userId)
    });
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

export const subscribeToGroupDetails = (groupId: string, callback: (data: any) => void) => {
    if (!isConfigured || !db) {
        callback(mockDb[groupId]?.details || null);
        return () => {};
    }
    return onSnapshot(doc(db, 'groups', groupId), (doc) => {
        if (doc.exists()) callback({ id: doc.id, ...doc.data() });
    });
};

export const updateGroup = async (groupId: string, updates: any) => {
    if (!isConfigured || !db) {
        if (mockDb[groupId]) {
             mockDb[groupId].details = { ...mockDb[groupId].details, ...updates };
        }
        return;
    }
    await updateDoc(doc(db, 'groups', groupId), updates);
};

export const setGroupCallState = async (groupId: string, isActive: boolean, userId?: string) => {
    if (!isConfigured || !db) {
        if (mockDb[groupId]) {
            mockDb[groupId].details.isCallActive = isActive;
            if (isActive && userId) {
                 mockDb[groupId].details.callStartedBy = userId;
                 mockDb[groupId].details.callParticipants = [userId];
            } else if (!isActive) {
                 mockDb[groupId].details.callParticipants = [];
            }
        }
        return;
    }
    
    const updates: any = { isCallActive: isActive };
    if (isActive && userId) {
        updates.callStartedBy = userId;
        updates.callParticipants = [userId]; // Reset participants on new call start
    } else if (!isActive) {
        updates.callParticipants = [];
    }
    await updateDoc(doc(db, 'groups', groupId), updates);
}

export const joinCallSession = async (groupId: string, userId: string) => {
    if (!isConfigured || !db) {
        if (mockDb[groupId]) {
            if (!mockDb[groupId].details.callParticipants) mockDb[groupId].details.callParticipants = [];
            if (!mockDb[groupId].details.callParticipants.includes(userId)) {
                 mockDb[groupId].details.callParticipants.push(userId);
            }
        }
        return;
    }
    await updateDoc(doc(db, 'groups', groupId), {
        callParticipants: arrayUnion(userId)
    });
}

export const leaveCallSession = async (groupId: string, userId: string) => {
    if (!isConfigured || !db) {
        if (mockDb[groupId] && mockDb[groupId].details.callParticipants) {
             const idx = mockDb[groupId].details.callParticipants.indexOf(userId);
             if (idx > -1) mockDb[groupId].details.callParticipants.splice(idx, 1);
             // Auto Close
             if (mockDb[groupId].details.callParticipants.length === 0) {
                 mockDb[groupId].details.isCallActive = false;
             }
        }
        return;
    }
    
    const groupRef = doc(db, 'groups', groupId);
    // Remove user
    await updateDoc(groupRef, {
        callParticipants: arrayRemove(userId)
    });

    // Check if empty (Auto-Close Logic)
    // There is a slight race condition here in high traffic but okay for this app
    const snap = await getDoc(groupRef);
    if (snap.exists()) {
        const data = snap.data();
        if (data.callParticipants && data.callParticipants.length === 0) {
            await updateDoc(groupRef, { isCallActive: false });
        }
    }
}

export const endGroupCall = async (groupId: string) => {
     if (!isConfigured || !db) {
         if (mockDb[groupId]) {
             mockDb[groupId].details.isCallActive = false;
             mockDb[groupId].details.callParticipants = [];
         }
         return;
     }
     await updateDoc(doc(db, 'groups', groupId), {
         isCallActive: false,
         callParticipants: []
     });
}

// Real-time AI Chat Subscription
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

// Real-time User Chat Subscription (New)
export const subscribeToUserChat = (groupId: string, callback: (messages: any[]) => void) => {
    // Offline Mode
    if (!isConfigured || !db) {
        if (!mockUserChatDb[groupId]) mockUserChatDb[groupId] = [];
        if (!mockUserChatListeners[groupId]) mockUserChatListeners[groupId] = [];
        mockUserChatListeners[groupId].push(callback);
        callback(mockUserChatDb[groupId]);
        return () => {
            const idx = mockUserChatListeners[groupId].indexOf(callback);
            if (idx > -1) mockUserChatListeners[groupId].splice(idx, 1);
        };
    }

    // Real Mode
    const q = query(
        collection(db, 'groups', groupId, 'user_messages'),
        orderBy('timestamp', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(msgs);
    });
};

// Send AI Prompt
export const sendMessage = async (groupId: string, message: any) => {
  const msgData = { 
      ...message, 
      timestamp: Date.now(),
      status: message.role === 'user' ? 'queued' : 'done' 
  };

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

// Send User Chat Message (New)
export const sendUserChatMessage = async (groupId: string, message: any) => {
    const msgData = {
        ...message,
        timestamp: Date.now()
    };

    if (!isConfigured || !db) {
        if (!mockUserChatDb[groupId]) mockUserChatDb[groupId] = [];
        mockUserChatDb[groupId].push(msgData);
        mockUserChatListeners[groupId]?.forEach(cb => cb(mockUserChatDb[groupId]));
        return;
    }

    await addDoc(collection(db, 'groups', groupId, 'user_messages'), msgData);
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

// Delete Message
export const deleteMessage = async (groupId: string, messageId: string) => {
    // Offline Mode
    if (!isConfigured || !db) {
        if (mockDb[groupId]) {
            const idx = mockDb[groupId].messages.findIndex((m: any) => m.id === messageId);
            if (idx > -1) {
                mockDb[groupId].messages.splice(idx, 1);
                mockListeners[groupId]?.forEach(cb => cb(mockDb[groupId].messages));
            }
        }
        return;
    }

    // Real Mode
    const msgRef = doc(db, 'groups', groupId, 'messages', messageId);
    await deleteDoc(msgRef);
}

// Delete User Chat Message (New)
export const deleteUserChatMessage = async (groupId: string, messageId: string) => {
    // Offline Mode
    if (!isConfigured || !db) {
        if (mockUserChatDb[groupId]) {
            const idx = mockUserChatDb[groupId].findIndex((m: any) => m.id === messageId);
            if (idx > -1) {
                mockUserChatDb[groupId].splice(idx, 1);
                mockUserChatListeners[groupId]?.forEach(cb => cb(mockUserChatDb[groupId]));
            }
        }
        return;
    }

    // Real Mode
    const msgRef = doc(db, 'groups', groupId, 'user_messages', messageId);
    await deleteDoc(msgRef);
}

// Subscribe to User Groups (Created + Joined)
export const subscribeToUserGroups = (userId: string, callback: (groups: any[]) => void) => {
    if (!isConfigured || !db) {
        mockUserGroupsListeners.push(callback);
        notifyMockGroupListeners();
        return () => {
             const idx = mockUserGroupsListeners.indexOf(callback);
             if (idx > -1) mockUserGroupsListeners.splice(idx, 1);
        };
    }

    // Firestore OR queries are limited, so we subscribe to "members array-contains userId"
    // This covers both created (creator is a member) and joined.
    const q = query(collection(db, 'groups'), where('members', 'array-contains', userId));
    
    return onSnapshot(q, (snapshot) => {
        const groups = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(groups);
    });
}

// Delete Group Full
export const deleteGroupFull = async (groupId: string) => {
    if (!isConfigured || !db) {
        delete mockDb[groupId];
        notifyMockGroupListeners();
        return;
    }

    // In a real app, use a Cloud Function for recursive delete. 
    // Here we will try to delete the group doc. Subcollections might persist but become orphaned.
    await deleteDoc(doc(db, 'groups', groupId));
}

// Group Locking (For exclusive editing)
export const setGroupLock = async (groupId: string, userId: string | null) => {
     if (!isConfigured || !db) {
         if (mockDb[groupId]) {
             mockDb[groupId].details.lockedBy = userId;
             mockDb[groupId].details.lockedAt = Date.now();
         }
         return;
     }

     const groupRef = doc(db, 'groups', groupId);
     await updateDoc(groupRef, {
         lockedBy: userId,
         lockedAt: Date.now()
     });
}

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

// --- Presence Functions ---

export const updatePresence = async (groupId: string, user: any) => {
    if (!user) return;
    
    if (!isConfigured || !db) {
        if (!mockPresenceDb[groupId]) mockPresenceDb[groupId] = {};
        mockPresenceDb[groupId][user.uid] = {
            uid: user.uid,
            displayName: user.displayName || 'Guest',
            lastActive: Date.now(),
            isOnline: true
        };
        mockPresenceListeners[groupId]?.forEach(cb => cb(Object.values(mockPresenceDb[groupId])));
        return;
    }

    const presenceRef = doc(db, 'groups', groupId, 'presence', user.uid);
    await setDoc(presenceRef, {
        uid: user.uid,
        displayName: user.displayName || 'Guest',
        lastActive: Date.now(),
        isOnline: true
    }, { merge: true });
};

export const subscribeToPresence = (groupId: string, callback: (users: any[]) => void) => {
    if (!isConfigured || !db) {
        if (!mockPresenceListeners[groupId]) mockPresenceListeners[groupId] = [];
        mockPresenceListeners[groupId].push(callback);
        callback(Object.values(mockPresenceDb[groupId] || {}));
        return () => {};
    }

    const q = query(collection(db, 'groups', groupId, 'presence'));
    return onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(doc => doc.data());
        // Simple filter: active in last 2 minutes
        const onlineUsers = users.filter((u: any) => (Date.now() - u.lastActive) < 120000);
        callback(onlineUsers);
    });
};