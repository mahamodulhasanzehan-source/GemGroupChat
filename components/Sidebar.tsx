import React, { useState, useEffect } from 'react';
import { PlusIcon, UserGroupIcon, MenuIcon, TrashIcon, XMarkIcon } from './Icons';
import { updateUserProfile, subscribeToUserGroups, deleteGroupFull } from '../services/firebase';
import { useNavigate } from 'react-router-dom';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  currentUser: any;
  // Shared state for settings
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
    isCollapsed, setIsCollapsed, onCreateGroup, onJoinGroup, currentUser,
    aiVoice = 'Fenrir', setAiVoice, playbackSpeed = 1.2, setPlaybackSpeed
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(currentUser?.displayName || '');
  const [myGroups, setMyGroups] = useState<any[]>([]);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

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

  const createdGroups = myGroups.filter(g => g.createdBy === currentUser?.uid);
  const joinedGroups = myGroups.filter(g => g.createdBy !== currentUser?.uid);

  return (
    <div className={`flex flex-col h-full bg-[#1E1F20] transition-all duration-300 ${isCollapsed ? 'w-[72px]' : 'w-[280px]'} border-r border-[#444746] relative`}>
      <div className="p-4 flex items-center justify-between">
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 hover:bg-[#333537] rounded-full text-[#E3E3E3] transition-colors"
        >
          <MenuIcon />
        </button>
      </div>

      <div className="px-3 pb-4 space-y-2">
        {/* Create Group - Primary Action */}
        <button 
          onClick={onCreateGroup}
          className={`flex items-center gap-3 bg-[#1A1A1C] hover:bg-[#282A2C] text-[#E3E3E3] rounded-full px-4 py-3 w-full transition-all duration-200 border border-[#444746] ${isCollapsed ? 'justify-center px-2' : ''}`}
        >
          <PlusIcon />
          {!isCollapsed && <span className="text-sm font-medium">Create Group</span>}
        </button>

        {/* Join Group - Secondary Action */}
        <button 
          onClick={onJoinGroup}
          className={`flex items-center gap-3 hover:bg-[#333537] text-[#E3E3E3] rounded-full px-4 py-3 w-full transition-all duration-200 ${isCollapsed ? 'justify-center px-2' : ''}`}
        >
          <UserGroupIcon />
          {!isCollapsed && <span className="text-sm font-medium">Join a group</span>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-6">
        {!isCollapsed && (
             <>
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
                                    onClick={() => navigate(`/group/${group.id}`)}
                                    className="group flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#333537] cursor-pointer transition-colors"
                                >
                                    <span className="text-sm text-[#E3E3E3] truncate">{group.name}</span>
                                    <button 
                                        onClick={(e) => handleDeleteGroup(e, group.id)}
                                        className="opacity-0 group-hover:opacity-100 text-[#C4C7C5] hover:text-red-400 p-1"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Joined Groups */}
                <div>
                    <h3 className="text-xs font-semibold text-[#C4C7C5] uppercase tracking-wider mb-2 px-2">Joined Groups</h3>
                     {joinedGroups.length === 0 ? (
                        <p className="text-xs text-[#5E5E5E] px-2 italic">No joined groups.</p>
                    ) : (
                        <div className="space-y-1">
                             {joinedGroups.map(group => (
                                <div 
                                    key={group.id}
                                    onClick={() => navigate(`/group/${group.id}`)}
                                    className="group flex items-center px-3 py-2 rounded-lg hover:bg-[#333537] cursor-pointer transition-colors"
                                >
                                    <span className="text-sm text-[#E3E3E3] truncate">{group.name}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
             </>
        )}
      </div>

      <div className="p-3 border-t border-[#444746]">
        <div 
            className={`flex items-center gap-2 mt-2 p-2 rounded-lg cursor-pointer hover:bg-[#333537] transition-colors ${isCollapsed ? 'justify-center' : ''}`}
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
           
           {!isCollapsed && (
             <div className="flex flex-col flex-1 overflow-hidden">
                <span className="text-sm text-[#E3E3E3] truncate font-medium" title={currentUser?.displayName}>
                    {currentUser?.displayName || 'Guest User'}
                </span>
                <span className="text-[10px] text-[#C4C7C5]">Settings</span>
             </div>
           )}
        </div>
      </div>

      {/* --- Profile Settings Modal --- */}
      {isProfileModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
              <div className="bg-[#1E1F20] border border-[#444746] rounded-2xl w-full max-w-sm p-6 shadow-2xl relative">
                  <button 
                      onClick={() => setIsProfileModalOpen(false)}
                      className="absolute top-4 right-4 text-[#C4C7C5] hover:text-white"
                  >
                      <XMarkIcon />
                  </button>

                  <h2 className="text-lg font-medium text-[#E3E3E3] mb-6">Profile & Settings</h2>
                  
                  {/* Avatar Section */}
                  <div className="flex flex-col items-center mb-6">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-2xl font-bold text-white overflow-hidden mb-4 border-2 border-[#444746]">
                        {currentUser?.photoURL ? (
                            <img src={currentUser.photoURL} alt="User" className="w-full h-full object-cover" />
                        ) : (
                            <span>{currentUser?.displayName?.[0] || 'U'}</span>
                        )}
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
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            </button>
                        </div>
                      )}

                      {/* Avatar Picker */}
                      <div className="flex gap-2 justify-center">
                          {AVATAR_PRESETS.map((url, i) => (
                              <button 
                                key={i}
                                onClick={() => handleAvatarSelect(url)}
                                className={`w-8 h-8 rounded-full overflow-hidden border-2 transition-all ${currentUser?.photoURL === url ? 'border-[#4285F4] scale-110' : 'border-transparent hover:border-[#444746]'}`}
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
                                className="w-full bg-[#131314] text-[#E3E3E3] border border-[#444746] rounded-lg px-3 py-2 text-sm appearance-none outline-none focus:border-[#4285F4]"
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

              </div>
          </div>
      )}
    </div>
  );
};

export default Sidebar;