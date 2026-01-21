import React, { useState } from 'react';
import { PlusIcon, UserGroupIcon, MenuIcon } from './Icons';
import { updateUserProfile } from '../services/firebase';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  currentUser: any;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, setIsCollapsed, onCreateGroup, onJoinGroup, currentUser }) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(currentUser?.displayName || '');

  const handleNameSave = () => {
      if (tempName.trim()) {
          updateUserProfile(tempName);
          setIsEditingName(false);
      }
  };

  return (
    <div className={`flex flex-col h-full bg-[#1E1F20] transition-all duration-300 ${isCollapsed ? 'w-[72px]' : 'w-[280px]'} border-r border-[#444746]`}>
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

      <div className="flex-1 overflow-y-auto px-3">
        {/* Empty State - No history/chats list as requested */}
        {!isCollapsed && (
             <div className="mt-8 text-center px-4">
                 <p className="text-xs text-[#C4C7C5]">Start a group to begin chatting.</p>
             </div>
        )}
      </div>

      <div className="p-3 border-t border-[#444746]">
        <div className={`flex items-center gap-2 mt-2 p-2 ${isCollapsed ? 'justify-center' : ''}`}>
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
                {isEditingName ? (
                    <div className="flex items-center gap-1">
                        <input 
                            type="text" 
                            value={tempName}
                            onChange={(e) => setTempName(e.target.value)}
                            className="bg-[#131314] text-xs text-[#E3E3E3] border border-[#444746] rounded px-1 py-0.5 w-full outline-none"
                            autoFocus
                        />
                        <button onClick={handleNameSave} className="text-green-400 text-xs hover:bg-[#333537] p-1 rounded">✓</button>
                    </div>
                ) : (
                    <div className="flex items-center justify-between group">
                        <span className="text-sm text-[#E3E3E3] truncate font-medium" title={currentUser?.displayName}>
                            {currentUser?.displayName || 'Guest User'}
                        </span>
                        <button 
                            onClick={() => { setTempName(currentUser?.displayName || ''); setIsEditingName(true); }}
                            className="text-[#C4C7C5] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                    </div>
                )}
                {/* Removed Plan text as requested */}
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;