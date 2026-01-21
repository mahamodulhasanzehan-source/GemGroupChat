import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './services/firebase';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import GroupModal from './components/GroupModal';
import { Message, UserProfile } from './types';
import { SparklesIcon } from './components/Icons';

// Configuration Error Component
const ConfigErrorScreen = () => (
  <div className="min-h-screen bg-[#131314] flex flex-col items-center justify-center p-6 text-[#E3E3E3] font-sans">
    <div className="max-w-md w-full bg-[#1E1F20] border border-[#D96570] rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-[#D96570]"></div>
        <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#2B1B1D] rounded-full flex items-center justify-center text-[#D96570]">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
            </div>
        </div>
        <h1 className="text-2xl font-semibold text-center mb-2">Configuration Missing</h1>
        <p className="text-[#C4C7C5] text-center text-sm mb-6">
           The application could not find the required Environment Variables. If you are running locally, please ensure these variables are set.
        </p>

        <div className="bg-[#131314] rounded-lg p-4 border border-[#444746] overflow-x-auto">
            <p className="text-xs font-mono text-[#A8C7FA] mb-2">Required Variables:</p>
            <ul className="text-xs font-mono text-[#E3E3E3] space-y-1">
                <li className="flex justify-between"><span>GEMGROUPCHAT_KEY</span> <span className="text-red-400">Missing</span></li>
                <li className="flex justify-between"><span>GEMGROUPCHAT_AUTH</span> <span className="text-red-400">Missing</span></li>
                <li className="flex justify-between"><span>GEMGROUPCHAT_ID</span> <span className="text-red-400">Missing</span></li>
                <li className="flex justify-between"><span>GEMINI_API_KEY_1</span> <span className="text-yellow-400">Check</span></li>
            </ul>
        </div>
        
        <p className="text-xs text-[#C4C7C5] mt-6 text-center">
            Refer to the README or Vercel dashboard to configure your project.
        </p>
    </div>
  </div>
);

// Wrapper to handle layout based on auth status
const Layout = ({ children, currentUser, onSignOut, onCreateGroup, onNewChat }: any) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  return (
    <div className="flex h-screen w-full bg-[#131314] text-[#E3E3E3] font-sans overflow-hidden">
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        setIsCollapsed={setIsSidebarCollapsed}
        onCreateGroup={() => setIsGroupModalOpen(true)}
        onNewChat={onNewChat}
        currentUser={currentUser}
      />
      <div className="flex-1 h-full flex flex-col relative">
         {children}
      </div>
      <GroupModal 
        isOpen={isGroupModalOpen} 
        onClose={() => setIsGroupModalOpen(false)} 
        currentUser={currentUser}
      />
    </div>
  );
};

// Chat Page Wrapper
const ChatPage = ({ currentUser }: { currentUser: UserProfile }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const location = useLocation();
    
    // Extract Group ID from path if present (using hash router)
    // format: #/group/XYZ
    const isGroup = location.pathname.startsWith('/group/');
    const groupId = isGroup ? location.pathname.split('/')[2] : undefined;

    const handleNewChat = () => {
        setMessages([]);
        // Ideally navigate to root / if inside a group, or just clear messages
        if (groupId) window.location.hash = '/';
    };

    return (
        <Layout currentUser={currentUser} onNewChat={handleNewChat}>
            <ChatInterface 
                currentUser={currentUser} 
                messages={messages} 
                setMessages={setMessages}
                groupId={groupId}
            />
        </Layout>
    );
};


const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    // If auth failed to initialize in firebase.ts, we show error screen
    if (!auth) {
        setAuthError(true);
        setLoading(false);
        return;
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          isAnonymous: firebaseUser.isAnonymous
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (authError) {
      return <ConfigErrorScreen />;
  }

  if (loading) {
    return (
        <div className="h-screen w-full bg-[#131314] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
               <div className="relative">
                 <div className="w-12 h-12 bg-blue-500/20 rounded-full animate-ping absolute top-0 left-0"></div>
                 <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="Loading" className="w-12 h-12 relative z-10 animate-spin-slow" />
               </div>
               <div className="text-[#E3E3E3] font-medium animate-pulse">Initializing GemGroupChat...</div>
            </div>
        </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" />} />
        
        <Route path="/" element={
            user ? <ChatPage currentUser={user} /> : <Navigate to="/login" />
        } />

        <Route path="/group/:groupId" element={
            user ? <ChatPage currentUser={user} /> : <Navigate to="/login" />
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
