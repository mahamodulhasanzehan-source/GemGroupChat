import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { subscribeToAuth } from './services/firebase';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import GroupModal from './components/GroupModal';
import { UserProfile } from './types';

// Welcome Screen Component for Root Route
const WelcomeScreen = ({ onCreate, onJoin }: { onCreate: () => void, onJoin: () => void }) => {
    return (
        <div className="flex-1 h-full bg-[#131314] flex flex-col items-center justify-center p-6 text-center animate-[fadeIn_0.5s_ease-out]">
            <div className="max-w-2xl space-y-8">
                <h1 className="text-5xl font-medium tracking-tight">
                    <span className="gemini-gradient-text">Welcome to GemGroupChat</span>
                </h1>
                <p className="text-xl text-[#C4C7C5] max-w-lg mx-auto">
                    Collaborate with Gemini in real-time. Join an existing group or start a new session to begin.
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
                    {/* Updated button color to #4285F4 (Darker Google Blue) */}
                    <button 
                        onClick={onCreate}
                        className="px-8 py-3 bg-[#4285F4] text-white rounded-full font-medium hover:bg-[#3367D6] transition-colors shadow-[0_0_15px_rgba(66,133,244,0.3)]"
                    >
                        Create New Group
                    </button>
                    <button 
                        onClick={onJoin}
                        className="px-8 py-3 border border-[#444746] text-[#E3E3E3] rounded-full font-medium hover:bg-[#333537] transition-colors"
                    >
                        Join Existing Group
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12 text-left">
                    <div className="bg-[#1E1F20] p-4 rounded-xl border border-[#444746]">
                        <div className="text-xl mb-2">🚀</div>
                        <h3 className="font-medium text-[#E3E3E3]">Fast & Fluid</h3>
                        <p className="text-sm text-[#C4C7C5] mt-1">Powered by Gemini 3 Flash Preview for instant responses.</p>
                    </div>
                    <div className="bg-[#1E1F20] p-4 rounded-xl border border-[#444746]">
                        <div className="text-xl mb-2">👥</div>
                        <h3 className="font-medium text-[#E3E3E3]">Multi-User</h3>
                        <p className="text-sm text-[#C4C7C5] mt-1">Real-time collaboration with shared context.</p>
                    </div>
                     <div className="bg-[#1E1F20] p-4 rounded-xl border border-[#444746]">
                        <div className="text-xl mb-2">🔒</div>
                        <h3 className="font-medium text-[#E3E3E3]">Guest Access</h3>
                        <p className="text-sm text-[#C4C7C5] mt-1">Join instantly without complex sign-ups.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Wrapper to handle layout based on auth status
const Layout = ({ children, currentUser, onSignOut }: any) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [modalState, setModalState] = useState<{isOpen: boolean, mode: 'create' | 'join'}>({ isOpen: false, mode: 'create' });

  return (
    <div className="flex h-screen w-full bg-[#131314] text-[#E3E3E3] font-sans overflow-hidden">
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        setIsCollapsed={setIsSidebarCollapsed}
        onCreateGroup={() => setModalState({ isOpen: true, mode: 'create' })}
        onJoinGroup={() => setModalState({ isOpen: true, mode: 'join' })}
        currentUser={currentUser}
      />
      <div className="flex-1 h-full flex flex-col relative">
         {/* If children is a function (render prop), pass handlers, otherwise just render */}
         {typeof children === 'function' 
            ? children({ 
                onCreate: () => setModalState({ isOpen: true, mode: 'create' }), 
                onJoin: () => setModalState({ isOpen: true, mode: 'join' }) 
              }) 
            : children
         }
      </div>
      <GroupModal 
        isOpen={modalState.isOpen} 
        mode={modalState.mode}
        onClose={() => setModalState({ ...modalState, isOpen: false })} 
        currentUser={currentUser}
      />
    </div>
  );
};

// Chat Page Wrapper
const ChatPage = ({ currentUser }: { currentUser: UserProfile }) => {
    const location = useLocation();
    
    // Extract Group ID from path if present (using hash router)
    const isGroup = location.pathname.startsWith('/group/');
    const groupId = isGroup ? location.pathname.split('/')[2] : undefined;

    return (
        <Layout currentUser={currentUser}>
           {({ onCreate, onJoin }: any) => (
               groupId ? (
                   <ChatInterface 
                        currentUser={currentUser} 
                        messages={[]} 
                        setMessages={() => {}} 
                        groupId={groupId}
                    />
               ) : (
                   <WelcomeScreen onCreate={onCreate} onJoin={onJoin} />
               )
           )}
        </Layout>
    );
};


const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Use the unified subscription that handles both Real and Mock auth
    const unsubscribe = subscribeToAuth((firebaseUser) => {
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
               <div className="relative">
                 <div className="w-12 h-12 bg-blue-500/20 rounded-full animate-ping absolute top-0 left-0"></div>
                 <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="Loading" className="w-12 h-12 relative z-10 animate-spin-slow" />
               </div>
               <div className="text-[#E3E3E3] font-medium animate-pulse">Initializing...</div>
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