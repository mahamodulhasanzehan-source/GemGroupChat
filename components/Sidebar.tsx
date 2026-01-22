
import React, { useState, useEffect } from 'react';
import { PlusIcon, UserGroupIcon, MenuIcon, TrashIcon, XMarkIcon, PencilIcon } from './Icons';
import { updateUserProfile, subscribeToUserGroups, deleteGroupFull, signOut } from '../services/firebase';
import { useNavigate } from 'react-router-dom';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  // Mobile props
  mobileOpen?: boolean;
  setMobileOpen?: (v: boolean) => void;
  // General props
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  currentUser: any;
  aiVoice?: string;
  setAiVoice?: (voice: string) => void;
  playbackSpeed?: number;
  setPlaybackSpeed?: (speed: number) => void;
}

const AVATAR_PRESETS = [
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Zoe',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Jack',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Midnight',
    'https://api.dicebear.com/7.x/adventurer/svg?seed=Coco'
];

const AI_VOICES = ['Fenrir', 'Puck', 'Charon', 'Kore', 'Aoede'];

const Sidebar: React.FC<SidebarProps> = ({ 
    isCollapsed, setIsCollapsed, mobileOpen, setMobileOpen,
    onCreateGroup, onJoinGroup, currentUser,
    aiVoice = 'Charon', setAiVoice, playbackSpeed = 1.5, setPlaybackSpeed
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(currentUser?.displayName || '');
  const [myGroups, setMyGroups] = useState<any[]>([]);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
      if (!currentUser?.uid) return;
      const unsubscribe = subscribeToUserGroups(currentUser.uid, (groups) => {
          setMyGroups(groups);
      });
      return () => unsubscribe();
  }, [currentUser]);

  // Profile Modal Escape Key Listener
  useEffect(() => {
      const handleEsc = (e: KeyboardEvent) => {
          if (e.key === 'Escape') setIsProfileModalOpen(false);
      };
      if (isProfileModalOpen) window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
  }, [isProfileModalOpen]);

  // Reset logout state on open
  useEffect(() => {
    if (isProfileModalOpen) setShowLogoutConfirm(false);
  }, [isProfileModalOpen]);

  const handleNameSave = () => {
      if (tempName.trim()) {
          updateUserProfile({ displayName: tempName });
          setIsEditingName(false);
      }
  };

  const handleDeleteGroup = async (e: React.MouseEvent, groupId: string) => {
      e.stopPropagation();
      if (confirm("Are you sure you want to permanently delete this group? This cannot be undone.")) {
          await deleteGroupFull(groupId);
          if (window.location.hash.includes(groupId)) {
              navigate('/');
          }
      }
  };

  const handleAvatarSelect = (url: string) => {
      updateUserProfile({ photoURL: url });
  }

  const handleCustomAvatar = () => {
      const url = prompt("Enter image URL for your profile picture:");
      if (url && url.trim().startsWith('http')) {
          updateUserProfile({ photoURL: url.trim() });
      }
  };

  const createdGroups = myGroups.filter(g => g.createdBy === currentUser?.uid);
  const joinedGroups = myGroups.filter(g => g.createdBy !== currentUser?.uid);

  const handleGroupClick = (groupId: string) => {
      navigate(`/group/${groupId}`);
      if (setMobileOpen) setMobileOpen(false);
  }

  const sidebarContent = (
    <>
      <div className="p-4 flex items-center justify-between smooth-transition shrink-0">
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 hover:bg-[#333537] rounded-full text-[#E3E3E3] transition-colors smooth-transition hidden md:block"
        >
          <MenuIcon />
        </button>
        {/* Mobile Close Button */}
        <div className="md:hidden w-full flex justify-between items-center">
             <span className="font-semibold text-[#E3E3E3]">Menu</span>
             <button 
                onClick={() => setMobileOpen && setMobileOpen(false)}
                className="p-1 text-[#C4C7C5] hover:text-white"
             >
                 <XMarkIcon />
             </button>
        </div>
      </div>

      <div className="px-3 pb-4 space-y-2 smooth-transition shrink-0">
        {/* Create Group - Primary Action */}
        <button 
          onClick={() => { onCreateGroup(); if(setMobileOpen) setMobileOpen(false); }}
          className={`flex items-center gap-3 bg-[#1A1A1C] hover:bg-[#282A2C] text-[#E3E3E3] rounded-full px-4 py-3 w-full transition-all duration-500 border border-[#444746] smooth-transition ${isCollapsed ? 'md:justify-center md:px-2' : ''}`}
        >
          <PlusIcon />
          <span className={`${isCollapsed ? 'md:hidden' : ''} text-sm font-medium animate-[fadeIn_0.5s_ease-out]`}>Create Group</span>
        </button>

        {/* Join Group - Secondary Action */}
        <button 
          onClick={() => { onJoinGroup(); if(setMobileOpen) setMobileOpen(false); }}
          className={`flex items-center gap-3 hover:bg-[#333537] text-[#E3E3E3] rounded-full px-4 py-3 w-full transition-all duration-500 smooth-transition ${isCollapsed ? 'md:justify-center md:px-2' : ''}`}
        >
          <UserGroupIcon />
          <span className={`${isCollapsed ? 'md:hidden' : ''} text-sm font-medium animate-[fadeIn_0.5s_ease-out]`}>Join a group</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-6 smooth-transition">
        {(!isCollapsed || mobileOpen) && (
             <div className="animate-[fadeIn_0.5s_ease-out]">
                {/* Created By Me */}
                <div>
                    <h3 className="text-xs font-semibold text-[#C4C7C5] uppercase tracking-wider mb-2 px-2">Created by me</h3>
                    {createdGroups.length === 0 ? (
                        <p className="text-xs text-[#5E5E5E] px-2 italic">No groups created.</p>
                    ) : (
                        <div className="space-y-1">
                            {createdGroups.map(group => (
                                <div 
                                    key={group.id}
                                    onClick={() => handleGroupClick(group.id)}
                                    className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#333537] cursor-pointer transition-colors smooth-transition"
                                >
                                    <span className="text-sm text-[#E3E3E3] truncate">{group.name}</span>
                                    <button 
                                        onClick={(e) => handleDeleteGroup(e, group.id)}
                                        className="opacity-0 group-hover:opacity-100 text-[#C4C7C5] hover:text-red-400 p-1 smooth-transition"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Joined Groups */}
                <div className="mt-6">
                    <h3 className="text-xs font-semibold text-[#C4C7C5] uppercase tracking-wider mb-2 px-2">Joined Groups</h3>
                     {joinedGroups.length === 0 ? (
                        <p className="text-xs text-[#5E5E5E] px-2 italic">No joined groups.</p>
                    ) : (
                        <div className="space-y-1">
                             {joinedGroups.map(group => (
                                <div 
                                    key={group.id}
                                    onClick={() => handleGroupClick(group.id)}
                                    className="group flex items-center px-3 py-2 rounded-lg hover:bg-[#333537] cursor-pointer transition-colors smooth-transition"
                                >
                                    <span className="text-sm text-[#E3E3E3] truncate">{group.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
             </div>
        )}
      </div>

      <div className="p-3 border-t border-[#444746] smooth-transition shrink-0">
        <div 
            className={`flex items-center gap-2 mt-2 p-2 rounded-lg cursor-pointer hover:bg-[#333537] transition-colors smooth-transition ${isCollapsed ? 'md:justify-center' : ''}`}
            onClick={() => setIsProfileModalOpen(true)}
        >
           {/* User Profile Mini */}
           <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden">
               {currentUser?.photoURL ? (
                   <img src={currentUser.photoURL} alt="User" className="w-full h-full object-cover" />
               ) : (
                   <span>{currentUser?.isAnonymous ? 'G' : currentUser?.displayName?.[0] || 'U'}</span>
               )}
           </div>
           
           <div className={`${isCollapsed ? 'md:hidden' : ''} flex flex-col flex-1 overflow-hidden animate-[fadeIn_0.3s_ease-out]`}>
                <span className="text-sm text-[#E3E3E3] truncate font-medium" title={currentUser?.displayName}>
                    {currentUser?.displayName || 'Guest User'}
                </span>
                <span className="text-[10px] text-[#C4C7C5]">Settings</span>
             </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div className={`hidden md:flex flex-col h-full bg-[#1E1F20] smooth-transition ${isCollapsed ? 'w-[72px]' : 'w-[280px]'} border-r border-[#444746] relative`}>
        {sidebarContent}
      </div>

      {/* Mobile Drawer */}
      <div className={`md:hidden fixed inset-0 z-50 pointer-events-none ${mobileOpen ? 'pointer-events-auto' : ''}`}>
           {/* Backdrop */}
           <div 
             className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
             onClick={() => setMobileOpen && setMobileOpen(false)}
           />
           
           {/* Sidebar Panel */}
           <div className={`absolute top-0 bottom-0 left-0 w-[85%] max-w-[300px] bg-[#1E1F20] border-r border-[#444746] shadow-2xl transition-transform duration-300 flex flex-col ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
               {sidebarContent}
           </div>
      </div>

      {/* --- Profile Settings Modal --- */}
      {isProfileModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.5s_ease-out]">
              <div className="bg-[#1E1F20] border border-[#444746] rounded-2xl w-full max-w-sm p-6 shadow-2xl relative smooth-transition">
                  <button 
                      onClick={() => setIsProfileModalOpen(false)}
                      className="absolute top-4 right-4 text-[#C4C7C5] hover:text-white transition-colors"
                  >
                      <XMarkIcon />
                  </button>

                  <h2 className="text-lg font-medium text-[#E3E3E3] mb-6">Profile & Settings</h2>
                  
                  {/* Avatar Section */}
                  <div className="flex flex-col items-center mb-6">
                      <div className="relative">
                          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-2xl font-bold text-white overflow-hidden mb-4 border-2 border-[#444746]">
                            {currentUser?.photoURL ? (
                                <img src={currentUser.photoURL} alt="User" className="w-full h-full object-cover" />
                            ) : (
                                <span>{currentUser?.displayName?.[0] || 'U'}</span>
                            )}
                          </div>
                          
                          {/* Custom Avatar Upload Button */}
                          <button 
                             onClick={handleCustomAvatar}
                             className="absolute bottom-4 right-0 p-1.5 bg-[#4285F4] text-white rounded-full hover:bg-[#3367D6] border border-[#1E1F20] shadow-sm smooth-transition hover:scale-110"
                             title="Upload Custom Avatar URL"
                          >
                             <PencilIcon className="w-3 h-3" />
                          </button>
                      </div>
                      
                      {/* Name Edit */}
                      {isEditingName ? (
                        <div className="flex items-center gap-2 mb-4 w-full justify-center">
                            <input 
                                type="text" 
                                value={tempName}
                                onChange={(e) => setTempName(e.target.value)}
                                className="bg-[#131314] text-sm text-[#E3E3E3] border border-[#444746] rounded px-2 py-1 outline-none text-center"
                                autoFocus
                            />
                            <button onClick={handleNameSave} className="text-green-400 text-xs hover:bg-[#333537] p-1.5 rounded border border-[#444746]">✓</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-4">
                            <span className="font-medium text-[#E3E3E3]">{currentUser?.displayName}</span>
                            <button onClick={() => { setTempName(currentUser?.displayName || ''); setIsEditingName(true); }} className="text-[#C4C7C5] hover:text-white">
                                <PencilIcon className="w-3 h-3" />
                            </button>
                        </div>
                      )}

                      {/* Avatar Picker */}
                      <div className="flex gap-2 justify-center">
                          {AVATAR_PRESETS.map((url, i) => (
                              <button 
                                key={i}
                                onClick={() => handleAvatarSelect(url)}
                                className={`w-8 h-8 rounded-full overflow-hidden border-2 transition-all duration-300 ${currentUser?.photoURL === url ? 'border-[#4285F4] scale-110' : 'border-transparent hover:border-[#444746]'}`}
                              >
                                  <img src={url} alt={`Avatar ${i}`} className="w-full h-full object-cover" />
                              </button>
                          ))}
                      </div>
                  </div>

                  <hr className="border-[#444746] mb-6" />

                  {/* AI Settings */}
                  <div className="space-y-5">
                      {/* Voice Selection */}
                      <div className="space-y-2">
                          <label className="text-xs text-[#C4C7C5] font-medium uppercase tracking-wider">AI Voice</label>
                          <div className="relative">
                            <select 
                                value={aiVoice}
                                onChange={(e) => setAiVoice && setAiVoice(e.target.value)}
                                className="w-full bg-[#131314] text-[#E3E3E3] border border-[#444746] rounded-lg px-3 py-2 text-sm appearance-none outline-none focus:border-[#4285F4] transition-colors"
                            >
                                {AI_VOICES.map(voice => (
                                    <option key={voice} value={voice}>{voice}</option>
                                ))}
                            </select>
                            <div className="absolute right-3 top-2.5 pointer-events-none text-[#C4C7C5]">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                            </div>
                          </div>
                      </div>

                      {/* Playback Speed */}
                      <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <label className="text-xs text-[#C4C7C5] font-medium uppercase tracking-wider">Playback Speed</label>
                            <span className="text-xs font-mono text-[#4285F4]">{playbackSpeed?.toFixed(1)}x</span>
                          </div>
                          <input 
                              type="range" 
                              min="0.5" 
                              max="2.0" 
                              step="0.1" 
                              value={playbackSpeed}
                              onChange={(e) => setPlaybackSpeed && setPlaybackSpeed(parseFloat(e.target.value))}
                              className="w-full h-1 bg-[#444746] rounded-lg appearance-none cursor-pointer accent-[#4285F4]"
                          />
                          <div className="flex justify-between text-[10px] text-[#5E5E5E]">
                              <span>0.5x</span>
                              <span>1.0x</span>
                              <span>2.0x</span>
                          </div>
                      </div>
                  </div>

                  {/* Sign Out Section */}
                  {!currentUser?.isAnonymous && (
                      <div className="mt-4 pt-4 border-t border-[#444746]">
                          {!showLogoutConfirm ? (
                              <button 
                                  onClick={() => setShowLogoutConfirm(true)}
                                  className="w-full py-2 rounded-lg bg-[#2A2B2D] text-[#E3E3E3] border border-[#444746] hover:bg-[#333537] text-sm font-medium transition-colors"
                              >
                                  Log Out
                              </button>
                          ) : (
                              <div className="bg-[#2A0000] border border-red-900/50 rounded-lg p-3 text-center animate-[fadeIn_0.3s_ease-out]">
                                  <p className="text-xs text-red-200 mb-3">Are you sure you want to log out?</p>
                                  <div className="flex gap-2">
                                      <button 
                                          onClick={() => setShowLogoutConfirm(false)}
                                          className="flex-1 py-1.5 rounded bg-[#333537] text-[#C4C7C5] text-xs hover:bg-[#444746] transition-colors"
                                      >
                                          No
                                      </button>
                                      <button 
                                          onClick={() => {
                                              signOut();
                                              setIsProfileModalOpen(false);
                                              navigate('/login');
                                          }}
                                          className="flex-1 py-1.5 rounded bg-red-600 text-white text-xs hover:bg-red-500 transition-colors"
                                      >
                                          Yes
                                      </button>
                                  </div>
                              </div>
                          )}
                      </div>
                  )}

              </div>
          </div>
      )}
    </>
  );
};

export default Sidebar;
