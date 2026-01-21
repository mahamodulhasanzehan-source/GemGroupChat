import React from 'react';
import { PlusIcon, UserGroupIcon, MenuIcon } from './Icons';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  onCreateGroup: () => void;
  onNewChat: () => void;
  currentUser: any;
}

const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, setIsCollapsed, onCreateGroup, onNewChat, currentUser }) => {
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

      <div className="px-3 pb-4">
        <button 
          onClick={onNewChat}
          className={`flex items-center gap-3 bg-[#1A1A1C] hover:bg-[#282A2C] text-[#E3E3E3] rounded-full px-4 py-3 w-full transition-all duration-200 border border-[#444746] ${isCollapsed ? 'justify-center px-2' : ''}`}
        >
          <PlusIcon />
          {!isCollapsed && <span className="text-sm font-medium">New chat</span>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        {!isCollapsed && <div className="text-xs font-medium text-[#C4C7C5] mb-2 px-3 mt-4">Recent</div>}
        {/* Mock History Items */}
        <div className="flex flex-col gap-1">
          {[1, 2, 3].map((i) => (
            <button key={i} className="flex items-center gap-2 p-2 rounded-full hover:bg-[#333537] text-sm text-[#E3E3E3] text-left truncate transition-colors">
              <span className="w-1 h-1 bg-white rounded-full ml-1 shrink-0"></span>
              {!isCollapsed && <span className="truncate">Sample Conversation {i}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 border-t border-[#444746]">
         <button 
          onClick={onCreateGroup}
          className={`flex items-center gap-3 hover:bg-[#333537] text-[#E3E3E3] rounded-lg p-3 w-full transition-all duration-200 ${isCollapsed ? 'justify-center' : ''}`}
        >
          <UserGroupIcon />
          {!isCollapsed && (
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium">Create Group</span>
              <span className="text-xs text-[#C4C7C5]">Collaborate with others</span>
            </div>
          )}
        </button>

        <div className={`flex items-center gap-2 mt-4 p-2 ${isCollapsed ? 'justify-center' : ''}`}>
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
