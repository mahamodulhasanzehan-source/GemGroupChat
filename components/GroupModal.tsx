import React, { useState } from 'react';
import { createGroup } from '../services/firebase';

interface GroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
}

const GroupModal: React.FC<GroupModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [step, setStep] = useState<'create' | 'share'>('create');
  const [groupName, setGroupName] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!groupName.trim()) return;
    setIsLoading(true);
    try {
      const groupId = await createGroup(groupName, currentUser.uid);
      const link = `${window.location.origin}/#/group/${groupId}`;
      setShareLink(link);
      setStep('share');
    } catch (error) {
      console.error("Failed to create group", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink);
    // Could add toast here
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-[#1E1F20] border border-[#444746] rounded-2xl w-full max-w-md p-6 shadow-2xl relative overflow-hidden">
        
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-medium text-[#E3E3E3]">
            {step === 'create' ? 'Create a New Group' : 'Invite Guests'}
          </h2>
          <p className="text-sm text-[#C4C7C5] mt-1">
            {step === 'create' ? 'Start a collaborative chat session.' : 'Share this link to let others join as guests.'}
          </p>
        </div>

        {/* Content */}
        {step === 'create' ? (
           <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#C4C7C5] mb-1">Group Name</label>
                <input 
                  type="text" 
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Project Alpha Brainstorm"
                  className="w-full bg-[#131314] border border-[#444746] rounded-lg p-3 text-[#E3E3E3] focus:border-[#A8C7FA] focus:outline-none transition-colors"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={onClose}
                  className="flex-1 py-2 rounded-full text-[#A8C7FA] hover:bg-[#333537] transition-colors font-medium text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreate}
                  disabled={!groupName.trim() || isLoading}
                  className="flex-1 py-2 rounded-full bg-[#A8C7FA] text-[#004A77] hover:bg-[#D3E3FD] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Creating...' : 'Create Group'}
                </button>
              </div>
           </div>
        ) : (
           <div className="space-y-6">
             <div className="bg-[#131314] border border-[#444746] rounded-lg p-4 break-all text-sm text-[#A8C7FA] font-mono">
                {shareLink}
             </div>
             
             <div className="flex gap-3">
               <button 
                  onClick={handleCopy}
                  className="flex-1 py-2 rounded-full bg-[#1A1A1C] border border-[#444746] text-[#E3E3E3] hover:bg-[#333537] transition-colors font-medium text-sm"
               >
                 Copy Link
               </button>
               <button 
                  onClick={() => {
                      onClose();
                      // Logic to redirect to the new group immediately
                      window.location.hash = `/group/${shareLink.split('/').pop()}`;
                  }}
                  className="flex-1 py-2 rounded-full bg-[#A8C7FA] text-[#004A77] hover:bg-[#D3E3FD] transition-colors font-medium text-sm"
               >
                 Go to Group
               </button>
             </div>
           </div>
        )}
      </div>
    </div>
  );
};

export default GroupModal;
