import React from 'react';
import { PlusIcon, UserGroupIcon, MenuIcon } from './Icons';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  currentUser: any;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, setIsCollapsed, onCreateGroup, onJoinGroup, currentUser }) => {
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
           <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {currentUser?.isAnonymous ? 'G' : currentUser?.displayName?.[0] || 'U'}
           </div>
           {!isCollapsed && (
             <div className="flex flex-col overflow-hidden">
                <span className="text-sm text-[#E3E3E3] truncate">{currentUser?.displayName || 'Guest User'}</span>
                <span className="text-xs text-[#C4C7C5] truncate">Standard Plan</span>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;