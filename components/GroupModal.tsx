import React, { useState, useEffect } from 'react';
import { createGroup, isConfigured, getGroupDetails, signOut, checkGroupNameTaken } from '../services/firebase';

interface GroupModalProps {
  isOpen: boolean;
  mode?: 'create' | 'join';
  onClose: () => void;
  currentUser: any;
}

const GroupModal: React.FC<GroupModalProps> = ({ isOpen, mode = 'create', onClose, currentUser }) => {
  const [activeTab, setActiveTab] = useState<'create' | 'join'>(mode);
  const [step, setStep] = useState<'input' | 'share'>('input');
  
  // Create State
  const [groupName, setGroupName] = useState('');
  
  // Join State
  const [joinGroupId, setJoinGroupId] = useState('');
  
  const [shareLink, setShareLink] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
        // If user is guest, default to join
        if (currentUser?.isAnonymous && mode === 'create') {
             setActiveTab('join');
        } else {
             setActiveTab(mode);
        }
        setStep('input');
        setGroupName('');
        setJoinGroupId('');
        setError('');
        setShareLink('');
    }
  }, [isOpen, mode, currentUser]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!groupName.trim() || currentUser?.isAnonymous) return;
    setIsLoading(true);
    setError('');

    try {
      // Check for uniqueness
      const isTaken = await checkGroupNameTaken(groupName);
      if (isTaken) {
          setError("This Group Name is already taken. Please choose another.");
          setIsLoading(false);
          return;
      }

      const groupId = await createGroup(groupName, currentUser.uid);
      const link = `${window.location.origin}/#/group/${groupId}`;
      setShareLink(link);
      setStep('share');
    } catch (error) {
      console.error("Failed to create group", error);
      setError("Failed to create group. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!joinGroupId.trim()) return;
    setIsLoading(true);
    setError('');
    
    // Extract ID from URL if full URL provided
    let targetId = joinGroupId.trim();
    if (targetId.includes('/group/')) {
        targetId = targetId.split('/group/')[1];
    }

    try {
        // Validate group exists (mock or real)
        const details = await getGroupDetails(targetId);
        if (details) {
            window.location.hash = `/group/${targetId}`;
            onClose();
        } else {
            setError("Group not found.");
        }
    } catch (e) {
        setError("Error joining group.");
    } finally {
        setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-[#1E1F20] border border-[#444746] rounded-2xl w-full max-w-md p-6 shadow-2xl relative overflow-hidden">
        
        {/* Tabs */}
        <div className="flex space-x-6 mb-6 border-b border-[#444746] pb-2">
            <button 
                onClick={() => { setActiveTab('create'); setStep('input'); }}
                className={`text-sm font-medium pb-2 transition-colors ${activeTab === 'create' ? 'text-[#4285F4] border-b-2 border-[#4285F4]' : 'text-[#C4C7C5]'}`}
            >
                Create Group
            </button>
            <button 
                onClick={() => { setActiveTab('join'); setStep('input'); }}
                className={`text-sm font-medium pb-2 transition-colors ${activeTab === 'join' ? 'text-[#4285F4] border-b-2 border-[#4285F4]' : 'text-[#C4C7C5]'}`}
            >
                Join Group
            </button>
        </div>

        {/* Content - Create Tab */}
        {activeTab === 'create' && (
            <>
                {currentUser?.isAnonymous ? (
                    <div className="space-y-4 text-center py-4">
                        <div className="text-4xl">🔒</div>
                        <h3 className="text-[#E3E3E3] font-medium">Authentication Required</h3>
                        <p className="text-sm text-[#C4C7C5]">
                            Guests cannot create new groups. Please sign in with Google to create a group, or join an existing one.
                        </p>
                        <div className="flex gap-3 pt-2">
                            <button 
                                onClick={onClose}
                                className="flex-1 py-2 rounded-full text-[#A8C7FA] hover:bg-[#333537] transition-colors font-medium text-sm"
                            >
                                Cancel
                            </button>
                             <button 
                                onClick={() => {
                                    signOut();
                                    onClose();
                                }}
                                className="flex-1 py-2 rounded-full bg-[#4285F4] text-white hover:bg-[#3367D6] transition-colors font-medium text-sm"
                            >
                                Sign In with Google
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {step === 'input' && (
                        <div className="space-y-4">
                            <p className="text-sm text-[#C4C7C5]">Enter a name for your new group session.</p>
                            <div>
                                <input 
                                type="text" 
                                value={groupName}
                                onChange={(e) => {
                                    setGroupName(e.target.value);
                                    setError('');
                                }}
                                placeholder="e.g. Project Alpha"
                                className={`w-full bg-[#131314] border ${error ? 'border-red-400' : 'border-[#444746]'} rounded-lg p-3 text-[#E3E3E3] focus:border-[#4285F4] focus:outline-none transition-colors`}
                                />
                                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
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
                                className="flex-1 py-2 rounded-full bg-[#4285F4] text-white hover:bg-[#3367D6] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                {isLoading ? 'Checking...' : 'Create'}
                                </button>
                            </div>
                        </div>
                        )}

                        {step === 'share' && (
                        <div className="space-y-6">
                            <p className="text-sm text-[#C4C7C5]">Share this link with others to invite them.</p>
                            <div className="bg-[#131314] border border-[#444746] rounded-lg p-4 break-all text-sm text-[#A8C7FA] font-mono select-all">
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
                                    window.location.hash = `/group/${shareLink.split('/').pop()}`;
                                }}
                                className="flex-1 py-2 rounded-full bg-[#4285F4] text-white hover:bg-[#3367D6] transition-colors font-medium text-sm"
                            >
                                Enter Group
                            </button>
                            </div>
                        </div>
                        )}
                    </>
                )}
            </>
        )}

        {/* Content - Join Tab */}
        {activeTab === 'join' && (
           <div className="space-y-4">
               <p className="text-sm text-[#C4C7C5]">Paste the group link or ID to join an existing session.</p>
               <div>
                <input 
                  type="text" 
                  value={joinGroupId}
                  onChange={(e) => setJoinGroupId(e.target.value)}
                  placeholder="https://... or group-id"
                  className="w-full bg-[#131314] border border-[#444746] rounded-lg p-3 text-[#E3E3E3] focus:border-[#4285F4] focus:outline-none transition-colors"
                />
               </div>
               {error && <p className="text-xs text-red-400">{error}</p>}
               <div className="flex gap-3 pt-2">
                <button 
                  onClick={onClose}
                  className="flex-1 py-2 rounded-full text-[#A8C7FA] hover:bg-[#333537] transition-colors font-medium text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleJoin}
                  disabled={!joinGroupId.trim() || isLoading}
                  className="flex-1 py-2 rounded-full bg-[#4285F4] text-white hover:bg-[#3367D6] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Joining...' : 'Join'}
                </button>
               </div>
           </div>
        )}

        {!isConfigured && (
            <div className="mt-4 pt-4 border-t border-[#444746]">
                <p className="text-xs text-yellow-500 bg-yellow-900/10 p-2 rounded">
                    Preview Mode: Groups are temporary and stored in memory.
                </p>
            </div>
        )}
      </div>
    </div>
  );
};

export default GroupModal;