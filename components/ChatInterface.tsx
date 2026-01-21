import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ImageUploadIcon, MicIcon, ChevronDownIcon, ChevronRightIcon, DotsHorizontalIcon, TrashIcon, PencilIcon } from './Icons';
import { Message, CanvasState, Presence, Group } from '../types';
import { streamGeminiResponse } from '../services/geminiService';
import { 
    subscribeToMessages, sendMessage, updateMessage, deleteMessage,
    subscribeToGroupDetails, subscribeToTokenUsage, updateGroup,
    subscribeToCanvas, updateCanvas, 
    subscribeToPresence, updatePresence, setGroupLock
} from '../services/firebase';
import ReactMarkdown from 'react-markdown';
import Canvas from './Canvas';

interface ChatInterfaceProps {
  currentUser: any;
  messages: Message[]; 
  setMessages: any;    
  groupId?: string;
}

const formatTokenCount = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ currentUser, groupId }) => {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [groupDetails, setGroupDetails] = useState<Group | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // UI State
  const [isCanvasCollapsed, setIsCanvasCollapsed] = useState(false);
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Presence[]>([]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  
  // Local Hide State (Session based)
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());

  // Edit Mode State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // Canvas State
  const [canvasState, setCanvasState] = useState<CanvasState>({ html: '', css: '', js: '', lastUpdated: 0, terminalOutput: [] });

  // Token Usage State
  const [tokenUsage, setTokenUsage] = useState<any>({});
  
  // Ref to track local processing state to prevent duplicate triggers
  const processingRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    if (!editingMessageId) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [localMessages]);

  useEffect(() => {
      const unsubscribe = subscribeToTokenUsage((data) => setTokenUsage(data));
      return () => unsubscribe();
  }, []);

  useEffect(() => {
      if (!groupId) return;
      
      const unsubscribeGroup = subscribeToGroupDetails(groupId, (details) => setGroupDetails(details));
      const unsubscribeMsgs = subscribeToMessages(groupId, (msgs) => setLocalMessages(msgs));
      
      const unsubscribeCanvas = subscribeToCanvas(groupId, (data) => {
          if (data) setCanvasState(data);
      });

      const unsubscribePresence = subscribeToPresence(groupId, (users) => setOnlineUsers(users));

      // Heartbeat
      const heartbeat = setInterval(() => {
          updatePresence(groupId, currentUser);
      }, 60000); 
      updatePresence(groupId, currentUser); 

      return () => {
          unsubscribeGroup();
          unsubscribeMsgs();
          unsubscribeCanvas();
          unsubscribePresence();
          clearInterval(heartbeat);
      };
  }, [groupId, currentUser]);

  // Extract Single HTML Code Block
  const extractCode = (text: string) => {
      // Look for ```html ... ``` block
      const htmlMatch = text.match(/```html\s*([\s\S]*?)(```|$)/i);
      // Fallback: If no tag, but looks like HTML
      const genericMatch = text.match(/```\s*([\s\S]*?)(```|$)/i);
      
      let code = null;
      if (htmlMatch) {
          code = htmlMatch[1];
      } else if (genericMatch && (genericMatch[1].includes('<html') || genericMatch[1].includes('<!DOCTYPE'))) {
          code = genericMatch[1];
      }

      return { html: code };
  };

  // --- Optimization Logic: Sliding Window + Heuristic Summary ---
  const prepareOptimizedHistory = (allMessages: Message[], currentMsgId: string) => {
      // 1. Filter out queued/generating/hidden/current messages
      const fullHistory = allMessages
        .filter(m => m.status !== 'queued' && m.id !== currentMsgId && !hiddenMessageIds.has(m.id))
        .map(m => ({
            role: m.role as 'user' | 'model',
            text: m.role === 'user' ? `[${m.senderName}]: ${m.text}` : m.text,
            originalText: m.text // keep for summarization check
        }));

      // 2. Sliding Window: Keep last 10 messages
      const MAX_HISTORY = 10;
      
      if (fullHistory.length <= MAX_HISTORY) {
          return fullHistory.map(m => ({ role: m.role, text: m.text }));
      }

      // 3. Slice the last N
      const recentHistory = fullHistory.slice(-MAX_HISTORY);
      const olderHistory = fullHistory.slice(0, -MAX_HISTORY);

      // 4. Heuristic Summary for Older Context
      // Since we can't use AI to summarize without cost, we use the first few user prompts to set the "topic"
      const firstUserMsg = olderHistory.find(m => m.role === 'user');
      const topic = firstUserMsg ? firstUserMsg.originalText.substring(0, 150) + "..." : "General Project";
      
      const summaryMsg = {
          role: 'model' as const,
          text: `[SYSTEM OPTIMIZATION]: The conversation history has been truncated. 
          Summary of older context: The discussion started with the topic "${topic}". 
          ${olderHistory.length} older messages were omitted to save tokens.`
      };

      return [summaryMsg, ...recentHistory.map(m => ({ role: m.role, text: m.text }))];
  };


  // --- Queue Processing Logic ---
  useEffect(() => {
      // Check if I am the "owner" of the next queued message
      if (!groupDetails || !groupId || localMessages.length === 0) return;

      const processQueue = async () => {
          const processingId = groupDetails.processingMessageId;
          
          // 1. Is the AI free (according to DB)?
          if (processingId) return; // Busy

          // 2. Find next queued message
          const queuedMessages = localMessages.filter(m => m.status === 'queued' && m.role === 'user');
          if (queuedMessages.length === 0) return;

          const nextMsg = queuedMessages[0]; // Oldest first

          // 3. Local Lock Check: Are we ALREADY processing this specific message locally?
          // This prevents the useEffect from firing multiple times for the same message before DB updates.
          if (processingRef.current === nextMsg.id) return;

          // 4. Am I the sender?
          if (nextMsg.senderId === currentUser.uid) {
              console.log("Processing Queue: My Turn", nextMsg.id);
              
              // Set local lock immediately
              processingRef.current = nextMsg.id;
              
              try {
                  await executeGeminiGeneration(nextMsg);
              } finally {
                  // Release local lock when done (or if error occurred and handled)
                  // We check if current ref matches to avoid clearing a subsequent lock
                  if (processingRef.current === nextMsg.id) {
                      processingRef.current = null;
                  }
              }
          }
      };

      processQueue();
  }, [groupDetails, localMessages, groupId, currentUser.uid]);


  const executeGeminiGeneration = async (userMsg: Message) => {
      if (!groupId) return;

      try {
          // Lock the queue in DB
          await updateGroup(groupId, { processingMessageId: userMsg.id });
          
          // Update message status to generating
          await updateMessage(groupId, userMsg.id, { status: 'generating' });

          // Create Model Placeholder
          const modelMsgId = (Date.now() + 1).toString();
          await sendMessage(groupId, {
            id: modelMsgId,
            text: '',
            senderId: 'gemini',
            senderName: 'Gemini',
            role: 'model',
            isLoading: true,
            status: 'generating'
          });

          // Build context using Optimized Sliding Window
          const validHistory = prepareOptimizedHistory(localMessages, userMsg.id);
          
          // Add current prompt
          validHistory.push({ role: 'user', text: `[${userMsg.senderName}]: ${userMsg.text}` });

          let accumulatedText = '';
          let lastUpdateTime = 0;
          const UPDATE_THROTTLE = 200;

          await streamGeminiResponse(
              userMsg.text,
              validHistory,
              canvasState,
              async (chunk) => {
                  accumulatedText += chunk;
                  
                  // Live Code Parsing & Update
                  const codeUpdates = extractCode(accumulatedText);
                  
                  if (codeUpdates.html && codeUpdates.html.length > canvasState.html.length) {
                       const now = Date.now();
                       if (now - lastUpdateTime > 500) {
                           await updateCanvas(groupId, { html: codeUpdates.html });
                       }
                  }

                  const now = Date.now();
                  if (now - lastUpdateTime > UPDATE_THROTTLE) {
                      lastUpdateTime = now;
                      await updateMessage(groupId, modelMsgId, { 
                          text: accumulatedText,
                          isLoading: true 
                      });
                  }
              }
          );

          // Final Sync
          const finalCode = extractCode(accumulatedText);
          if (finalCode.html) {
              await updateCanvas(groupId, { html: finalCode.html });
          }

          // Complete
          await updateMessage(groupId, modelMsgId, { text: accumulatedText, isLoading: false, status: 'done' });
          await updateMessage(groupId, userMsg.id, { status: 'done' });
          
          // Release Lock in DB
          await updateGroup(groupId, { processingMessageId: null });

      } catch (e) {
          console.error("Error generating", e);
          // Release lock on error
           await updateGroup(groupId, { processingMessageId: null });
           await updateMessage(groupId, userMsg.id, { status: 'done' }); // prevent stuck loop
      }
  };

  const handleSend = async () => {
    if (!input.trim() || isSending || !groupId) return;
    
    // Check Lock (Manual editing lock)
    if (groupDetails?.lockedBy && groupDetails.lockedBy !== currentUser.uid) {
        if (Date.now() - (groupDetails.lockedAt || 0) < 120000) {
            alert("Group is currently locked by another user editing a prompt.");
            return;
        }
    }

    setIsSending(true);
    const senderDisplayName = currentUser.displayName || 'Guest';

    try {
        if (editingMessageId) {
             await updateMessage(groupId, editingMessageId, { text: input });
             await setGroupLock(groupId, null);
             setEditingMessageId(null);
        } else {
            const userMsgId = Date.now().toString();
            await sendMessage(groupId, {
                id: userMsgId,
                text: input,
                senderId: currentUser.uid,
                senderName: senderDisplayName,
                role: 'user'
            });
        }
        setInput('');
    } catch (e) {
        console.error("Error sending", e);
    } finally {
        setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEdit = async (msg: Message) => {
      await setGroupLock(groupId!, currentUser.uid);
      setEditingMessageId(msg.id);
      setInput(msg.text);
  };

  const handleDelete = async (msg: Message) => {
      if (msg.senderId === currentUser.uid) {
           if (confirm("Permanently delete this prompt?")) {
               await deleteMessage(groupId!, msg.id);
           }
      } else {
           // Local Hide for others' prompts
           setHiddenMessageIds(prev => new Set(prev).add(msg.id));
      }
  };

  const activeIndex = tokenUsage.activeKeyIndex || 0;
  const currentKeyUsage = tokenUsage[`key_${activeIndex}`] || 0;
  
  // Filter messages for view (Remove queued and hidden)
  const visibleMessages = localMessages.filter(m => m.status !== 'queued' && !hiddenMessageIds.has(m.id));
  const queuedMessages = localMessages.filter(m => m.status === 'queued' && m.role === 'user');

  return (
    <div className="flex h-full bg-[#131314] overflow-hidden">
        
      {/* Left Panel: Chat */}
      <div className={`flex flex-col border-r border-[#444746] transition-all duration-300 ${isCanvasCollapsed ? 'w-full max-w-4xl mx-auto border-r-0' : 'w-[35%] min-w-[350px]'}`}>
        
        {/* Top Bar */}
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-[#444746] bg-[#131314]">
            <div className="flex items-center gap-2 relative">
                <span className="text-[#E3E3E3] font-medium tracking-tight truncate max-w-[150px]">
                    {groupDetails?.name || 'Chat'}
                </span>
                
                {/* Online Users */}
                <div className="relative">
                    <button 
                        onClick={() => setShowOnlineUsers(!showOnlineUsers)}
                        className="flex items-center gap-1 text-xs text-[#C4C7C5] hover:text-white bg-[#1E1F20] px-2 py-1 rounded-full border border-[#444746]"
                    >
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        {onlineUsers.length} Online
                        <ChevronDownIcon />
                    </button>
                    {showOnlineUsers && (
                        <div className="absolute top-full left-0 mt-2 w-48 bg-[#1E1F20] border border-[#444746] rounded-lg shadow-xl z-50 overflow-hidden">
                            <div className="max-h-40 overflow-y-auto">
                                {onlineUsers.map(u => (
                                    <div key={u.uid} className="px-3 py-2 text-xs text-[#C4C7C5] flex items-center gap-2 hover:bg-[#333537]">
                                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                        {u.displayName}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                 <div className="flex items-center gap-0 text-xs font-mono bg-[#1E1F20] border border-[#444746] rounded overflow-hidden shadow-sm">
                    <div className="bg-[#333537] text-[#A8C7FA] px-2 py-1 border-r border-[#444746]">
                        Key {activeIndex + 1}
                    </div>
                    <div className="text-[#C4C7C5] px-2 py-1">
                        {formatTokenCount(currentKeyUsage)} / 1M
                    </div>
                </div>

                {isCanvasCollapsed && (
                    <button 
                        onClick={() => setIsCanvasCollapsed(false)}
                        className="p-1.5 hover:bg-[#333537] text-[#E3E3E3] rounded-md border border-[#444746]"
                        title="Open Canvas"
                    >
                        <ChevronDownIcon /> 
                        <span className="text-xs ml-1">Canvas</span>
                    </button>
                )}
            </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center scroll-smooth relative">
            <div className="w-full space-y-6 pb-4">
                {visibleMessages.map((msg, index) => {
                const isMe = msg.senderId === currentUser.uid;
                const isGemini = msg.role === 'model';
                
                // Identify if this is the user's latest prompt
                const myMessages = visibleMessages.filter(m => m.senderId === currentUser.uid);
                const isMyLatest = myMessages.length > 0 && myMessages[myMessages.length - 1].id === msg.id;

                return (
                    <div 
                        key={msg.id} 
                        className={`group relative flex gap-3 ${isMe && !isGemini ? 'flex-row-reverse' : 'flex-row'} animate-[fadeIn_0.3s_ease-out]`}
                        onMouseEnter={() => setHoveredMessageId(msg.id)}
                        onMouseLeave={() => setHoveredMessageId(null)}
                    >
                        {/* Avatar */}
                        <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center overflow-hidden border border-[#444746] ${isGemini ? 'bg-transparent' : 'bg-[#1E1F20]'}`}>
                            {isGemini ? (
                            <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="AI" className="w-4 h-4 animate-[spin_10s_linear_infinite]" />
                            ) : (
                            <span className="text-[10px] text-white font-bold">{msg.senderName?.[0]?.toUpperCase() || 'U'}</span>
                            )}
                        </div>
                    
                        {/* Message Content */}
                        <div className={`flex flex-col max-w-[90%] ${isMe && !isGemini ? 'items-end' : 'items-start'}`}>
                            <div className={`prose prose-invert prose-sm text-[#E3E3E3] leading-relaxed break-words max-w-full rounded-lg px-3 py-2 shadow-sm ${isMe && !isGemini ? 'bg-[#1E1F20]' : 'bg-transparent pl-0'}`}>
                            <ReactMarkdown
                                    components={{
                                    code(props) {
                                        const {children, className, node, ...rest} = props
                                        const match = /language-(\w+)/.exec(className || '')
                                        if (match) {
                                            return (
                                                <div className="my-1 p-2 bg-[#131314] border border-[#444746] rounded text-xs text-[#A8C7FA] font-mono flex items-center gap-2">
                                                    <span>📄 Parsing {match[1]} to Canvas...</span>
                                                </div>
                                            );
                                        }
                                        return <code {...rest} className={`${className} bg-[#333537] px-1 rounded text-xs`}>{children}</code>
                                    }
                                    }}
                                >
                                    {msg.text}
                                </ReactMarkdown>
                            </div>
                        </div>

                        {/* Action Menu (Fixed Visibility for everyone) */}
                        {!isGemini && hoveredMessageId === msg.id && (
                            <div className={`flex items-center opacity-0 group-hover:opacity-100 transition-opacity self-center ${isMe ? 'mr-1' : 'ml-1'}`}>
                                <div className="relative group/menu">
                                    <button className="p-1 text-[#C4C7C5] hover:text-white hover:bg-[#333537] rounded">
                                        <DotsHorizontalIcon />
                                    </button>
                                    
                                    {/* Dropdown positioned based on alignment */}
                                    <div className={`absolute top-0 ${isMe ? 'right-full mr-1' : 'left-full ml-1'} bg-[#1E1F20] border border-[#444746] rounded shadow-lg z-10 w-24 overflow-hidden`}>
                                        {/* Edit - Only for my latest prompt */}
                                        {isMe && isMyLatest && (
                                            <button 
                                                onClick={() => handleEdit(msg)}
                                                className="w-full text-left px-3 py-2 text-xs text-[#E3E3E3] hover:bg-[#333537] flex items-center gap-2"
                                            >
                                                <PencilIcon /> Edit
                                            </button>
                                        )}
                                        
                                        {/* Delete - Real delete for me, Hide for others */}
                                        <button 
                                            onClick={() => handleDelete(msg)}
                                            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[#333537] flex items-center gap-2"
                                        >
                                            <TrashIcon /> {isMe ? 'Delete' : 'Hide'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
                })}
                <div ref={messagesEndRef} />
            </div>
        </div>

        {/* Floating Queue UI (Above Input) */}
        {queuedMessages.length > 0 && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-3/4 max-w-md bg-[#1E1F20]/90 backdrop-blur-md border border-[#444746] rounded-xl shadow-2xl p-3 z-20 animate-[slideUp_0.3s_ease-out]">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#444746]/50">
                    <span className="text-xs font-semibold text-[#A8C7FA] flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#A8C7FA] animate-pulse"></div>
                        Queue ({queuedMessages.length})
                    </span>
                    <span className="text-[10px] text-[#C4C7C5]">AI Processing Sequentially</span>
                </div>
                <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                    {queuedMessages.map((msg, i) => (
                        <div key={msg.id} className="flex items-start justify-between group p-2 rounded hover:bg-[#333537] transition-colors bg-[#131314]/50">
                            <div className="flex gap-2 items-center overflow-hidden">
                                <span className="text-[10px] text-[#C4C7C5] shrink-0 w-4">{i + 1}.</span>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[10px] font-bold text-[#E3E3E3]">{msg.senderName}</span>
                                    <span className="text-xs text-[#C4C7C5] truncate">{msg.text}</span>
                                </div>
                            </div>
                            {/* Delete from Queue if Mine */}
                            {msg.senderId === currentUser.uid && (
                                <button 
                                    onClick={() => deleteMessage(groupId!, msg.id)}
                                    className="text-[#C4C7C5] hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Remove from queue"
                                >
                                    <TrashIcon />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* Input */}
        <div className="p-3 bg-[#131314] border-t border-[#444746] z-30">
            {editingMessageId && (
                <div className="text-xs text-[#A8C7FA] mb-2 flex justify-between">
                    <span>Editing message... (Group Locked)</span>
                    <button onClick={() => { setEditingMessageId(null); setInput(''); setGroupLock(groupId!, null); }} className="hover:underline">Cancel</button>
                </div>
            )}
            <div className={`bg-[#1E1F20] rounded-full flex items-center px-3 py-2 gap-2 border transition-all ${editingMessageId ? 'border-[#4285F4]' : 'border-transparent focus-within:border-[#444746]'}`}>
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={editingMessageId ? "Edit your prompt..." : "Type instructions... (Added to queue)"}
                    className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#C4C7C5]"
                    disabled={isSending && !!editingMessageId} 
                />
                {(input.trim() || editingMessageId) && (
                    <button onClick={handleSend} className="p-1.5 bg-[#A8C7FA] text-[#000] rounded-full hover:scale-105 transition-transform">
                        <SendIcon />
                    </button>
                )}
            </div>
        </div>
      </div>

      {/* Right Panel: Canvas (Collapsible) */}
      {!isCanvasCollapsed && (
          <div className="flex-1 h-full flex flex-col min-w-0">
             <div className="h-8 bg-[#1E1F20] border-b border-[#444746] flex items-center justify-end px-2">
                 <button 
                    onClick={() => setIsCanvasCollapsed(true)}
                    className="p-1 hover:bg-[#333537] text-[#C4C7C5] rounded"
                    title="Collapse Canvas"
                 >
                     <ChevronRightIcon />
                 </button>
             </div>
             <div className="flex-1 overflow-hidden">
                <Canvas canvasState={canvasState} groupId={groupId || 'demo'} />
             </div>
          </div>
      )}

    </div>
  );
};

export default ChatInterface;