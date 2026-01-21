import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './services/firebase';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import GroupModal from './components/GroupModal';
import { Message, UserProfile } from './types';

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

  useEffect(() => {
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

  if (loading) {
    return (
        <div className="h-screen w-full bg-[#131314] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
               <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="Loading" className="w-12 h-12 animate-pulse" />
               <div className="text-[#E3E3E3] font-medium">Initializing GemGroupChat...</div>
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
