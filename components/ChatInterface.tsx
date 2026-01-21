import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ImageUploadIcon, MicIcon, ChevronDownIcon, ChevronRightIcon, DotsHorizontalIcon, TrashIcon, PencilIcon } from './Icons';
import { Message, CanvasState, Presence, Group } from '../types';
import { streamGeminiResponse } from '../services/geminiService';
import { 
    subscribeToMessages, sendMessage, updateMessage, deleteMessage,
    getGroupDetails, subscribeToTokenUsage, 
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
  const [groupDetails, setGroupDetails] = useState<any>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // UI State
  const [isCanvasCollapsed, setIsCanvasCollapsed] = useState(false);
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Presence[]>([]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);

  // Edit Mode State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  // Canvas State
  const [canvasState, setCanvasState] = useState<CanvasState>({ html: '', css: '', js: '', lastUpdated: 0, terminalOutput: [] });

  // Token Usage State
  const [tokenUsage, setTokenUsage] = useState<any>({});
  
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
      
      // Group Details & Locking
      // We need to poll or subscribe to group details for locking status
      // For simplicity, we assume getGroupDetails is static in this implementation 
      // but in real app we'd subscribe to group doc.
      getGroupDetails(groupId).then(details => setGroupDetails(details));

      const unsubscribeMsgs = subscribeToMessages(groupId, (msgs) => setLocalMessages(msgs));
      
      const unsubscribeCanvas = subscribeToCanvas(groupId, (data) => {
          if (data) setCanvasState(data);
      });

      const unsubscribePresence = subscribeToPresence(groupId, (users) => setOnlineUsers(users));

      // Heartbeat
      const heartbeat = setInterval(() => {
          updatePresence(groupId, currentUser);
      }, 60000); // Every minute
      updatePresence(groupId, currentUser); // Initial

      return () => {
          unsubscribeMsgs();
          unsubscribeCanvas();
          unsubscribePresence();
          clearInterval(heartbeat);
      };
  }, [groupId, currentUser]);

  // Extract Code Blocks helper with support for open tags (Live Streaming)
  const extractCode = (text: string) => {
      // Regex matches ```lang ...content... (``` or end of string)
      const htmlMatch = text.match(/```html\s*([\s\S]*?)(```|$)/i);
      const cssMatch = text.match(/```css\s*([\s\S]*?)(```|$)/i);
      const jsMatch = text.match(/```(javascript|js)\s*([\s\S]*?)(```|$)/i);
      
      return {
          html: htmlMatch ? htmlMatch[1] : null,
          css: cssMatch ? cssMatch[1] : null,
          js: jsMatch ? jsMatch[2] : null,
      };
  };

  const handleSend = async () => {
    if (!input.trim() || isSending || !groupId) return;
    
    // Check Lock
    if (groupDetails?.lockedBy && groupDetails.lockedBy !== currentUser.uid) {
        // If locked by someone else and lock is recent (< 2 mins)
        if (Date.now() - (groupDetails.lockedAt || 0) < 120000) {
            alert("Group is currently locked by another user editing a prompt.");
            return;
        }
    }

    setIsSending(true);
    const senderDisplayName = currentUser.displayName || 'Guest';

    try {
        let currentPrompt = input;
        
        // Handle Edit Mode
        if (editingMessageId) {
            // Update the existing message
            await updateMessage(groupId, editingMessageId, { text: input });
            // Release lock
            await setGroupLock(groupId, null);
            setEditingMessageId(null);
            
            // Delete subsequent AI messages to regenerate? 
            // The prompt says "nobody else can give a prompt... when AI is responding".
            // We just send a new generation request, which will append a NEW AI message usually.
            // But if we want to "replace" the flow, we might delete the old AI response. 
            // For safety and simplicity, we treat it as a new interaction contextually but chronologically fixed.
            // Actually, usually you delete the old AI response if you edit the prompt.
            // Let's find the AI response after this message.
            const msgIndex = localMessages.findIndex(m => m.id === editingMessageId);
            if (msgIndex !== -1 && msgIndex + 1 < localMessages.length) {
                const nextMsg = localMessages[msgIndex + 1];
                if (nextMsg.role === 'model') {
                    await deleteMessage(groupId, nextMsg.id);
                }
            }
        } else {
             // New Message
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

        // Prepare for AI Response
        const modelMsgId = (Date.now() + 1).toString();
        await sendMessage(groupId, {
            id: modelMsgId,
            text: '',
            senderId: 'gemini',
            senderName: 'Gemini',
            role: 'model',
            isLoading: true
        });

        // Build History
        // If we edited, the localMessages might not be updated yet via subscription, so be careful.
        // We rely on eventual consistency or pass explicit history.
        // Simplified: just use current localMessages but filter out the 'loading' one we just added? 
        // Actually subscription is fast.
        
        // Re-construct history from DB state (simulated)
        const history = localMessages.map(m => ({
            role: m.role as 'user' | 'model',
            text: m.role === 'user' ? `[${m.senderName}]: ${m.text}` : m.text
        }));
        // If we just sent a new message, append it manually if not in history yet
        if (!editingMessageId) {
             history.push({ role: 'user', text: `[${senderDisplayName}]: ${currentPrompt}` });
        } else {
            // If edited, history already contains the updated text (optimistically or via quick sync)
            // But to be safe, replace the last user message in history array
            // Fixed: findLastIndex compatibility
            let lastUserIdx = -1;
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'user') {
                    lastUserIdx = i;
                    break;
                }
            }
            if (lastUserIdx !== -1) history[lastUserIdx].text = `[${senderDisplayName}]: ${currentPrompt}`;
        }

        let accumulatedText = '';
        let lastUpdateTime = 0;
        const UPDATE_THROTTLE = 100; // Faster updates for "Live Writing" feel

        await streamGeminiResponse(
            currentPrompt,
            history,
            canvasState,
            async (chunk) => {
                accumulatedText += chunk;
                
                // Live Code Parsing
                const codeUpdates = extractCode(accumulatedText);
                const updates: any = {};
                let hasUpdates = false;

                // Only update if length changed significantly or tag detected
                if (codeUpdates.html && codeUpdates.html.length > canvasState.html.length) {
                    updates.html = codeUpdates.html;
                    hasUpdates = true;
                }
                if (codeUpdates.css && codeUpdates.css.length > canvasState.css.length) {
                    updates.css = codeUpdates.css;
                    hasUpdates = true;
                }
                if (codeUpdates.js && codeUpdates.js.length > canvasState.js.length) {
                    updates.js = codeUpdates.js;
                    hasUpdates = true;
                }

                if (hasUpdates) {
                     // Direct update to canvas for "Live Writing" effect
                     // Note: In a real multi-user app, this might be too frequent for Firestore write limits (1/s).
                     // Ideally we write to a memory buffer or ephemeral state. 
                     // For this demo, we'll throttle the canvas update too.
                     const now = Date.now();
                     if (now - lastUpdateTime > 500) { // Throttle canvas 500ms
                         await updateCanvas(groupId, updates);
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

        // Final Canvas Sync
        const finalCode = extractCode(accumulatedText);
        if (finalCode.html || finalCode.css || finalCode.js) {
            await updateCanvas(groupId, {
                html: finalCode.html || canvasState.html,
                css: finalCode.css || canvasState.css,
                js: finalCode.js || canvasState.js
            });
        }

        await updateMessage(groupId, modelMsgId, { 
            text: accumulatedText,
            isLoading: false 
        });

    } catch (e) {
        console.error("Error in chat flow", e);
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
      // Lock group
      await setGroupLock(groupId!, currentUser.uid);
      setEditingMessageId(msg.id);
      setInput(msg.text);
      // Focus input?
  };

  const handleDelete = async (msgId: string) => {
      if (confirm("Delete this prompt?")) {
          await deleteMessage(groupId!, msgId);
      }
  };

  // Calculate current key usage stats
  const activeIndex = tokenUsage.activeKeyIndex || 0;
  const currentKeyUsage = tokenUsage[`key_${activeIndex}`] || 0;

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
                
                {/* Online Users Dropdown */}
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
                            <div className="px-3 py-2 text-xs font-semibold text-[#E3E3E3] border-b border-[#444746] bg-[#2D2E30]">
                                Active Users
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                                {onlineUsers.map(u => (
                                    <div key={u.uid} className="px-3 py-2 text-xs text-[#C4C7C5] flex items-center gap-2 hover:bg-[#333537]">
                                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                        {u.displayName} {u.uid === currentUser.uid && '(You)'}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                 {/* Token Usage Rectangle */}
                <div className="flex items-center gap-0 text-xs font-mono bg-[#1E1F20] border border-[#444746] rounded overflow-hidden shadow-sm">
                    <div className="bg-[#333537] text-[#A8C7FA] px-2 py-1 border-r border-[#444746]">
                        Key {activeIndex + 1}
                    </div>
                    <div className="text-[#C4C7C5] px-2 py-1">
                        {formatTokenCount(currentKeyUsage)} / 1M
                    </div>
                </div>

                {/* Expand Canvas Button (Visible only if collapsed) */}
                {isCanvasCollapsed && (
                    <button 
                        onClick={() => setIsCanvasCollapsed(false)}
                        className="p-1.5 hover:bg-[#333537] text-[#E3E3E3] rounded-md border border-[#444746]"
                        title="Open Canvas"
                    >
                        <ChevronDownIcon /> {/* Reusing icon rotated via CSS or similar, simplified here */}
                        <span className="text-xs ml-1">Canvas</span>
                    </button>
                )}
            </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center scroll-smooth relative">
            {localMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#C4C7C5] opacity-50 mt-10">
                <p className="text-sm font-light">Ask Gemini to write some code!</p>
            </div>
            ) : (
            <div className="w-full space-y-6 pb-4">
                {localMessages.map((msg, index) => {
                const isMe = msg.senderId === currentUser.uid;
                const isGemini = msg.role === 'model';
                const isLatestMe = isMe && index === localMessages.length - 1 - (localMessages[localMessages.length-1].role === 'model' ? 1 : 0); // Logic slightly complex due to async model msg.
                // Simplified: Is latest of *my* messages
                const myMessages = localMessages.filter(m => m.senderId === currentUser.uid);
                const isMyLatest = myMessages.length > 0 && myMessages[myMessages.length - 1].id === msg.id;

                return (
                    <div 
                        key={msg.id} 
                        className={`group relative flex gap-3 ${isMe && !isGemini ? 'flex-row-reverse' : 'flex-row'} animate-[fadeIn_0.3s_ease-out]`}
                        onMouseEnter={() => setHoveredMessageId(msg.id)}
                        onMouseLeave={() => setHoveredMessageId(null)}
                    >
                    <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center overflow-hidden border border-[#444746] ${isGemini ? 'bg-transparent' : 'bg-[#1E1F20]'}`}>
                        {isGemini ? (
                        <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="AI" className="w-4 h-4 animate-[spin_10s_linear_infinite]" />
                        ) : (
                        <span className="text-[10px] text-white font-bold">{msg.senderName?.[0]?.toUpperCase() || 'U'}</span>
                        )}
                    </div>
                    
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

                    {/* Action Menu (3 Dots) */}
                    {isMe && !isGemini && hoveredMessageId === msg.id && (
                        <div className="absolute top-0 right-0 transform translate-x-full pl-2">
                             <div className="relative group/menu">
                                <button className="p-1 text-[#C4C7C5] hover:text-white hover:bg-[#333537] rounded">
                                    <DotsHorizontalIcon />
                                </button>
                                {/* Dropdown */}
                                <div className="absolute left-full top-0 ml-1 hidden group-hover/menu:block bg-[#1E1F20] border border-[#444746] rounded shadow-lg z-10 w-24">
                                     {isMyLatest && (
                                         <button 
                                            onClick={() => handleEdit(msg)}
                                            className="w-full text-left px-3 py-2 text-xs text-[#E3E3E3] hover:bg-[#333537] flex items-center gap-2"
                                         >
                                             <PencilIcon /> Edit
                                         </button>
                                     )}
                                     <button 
                                        onClick={() => handleDelete(msg.id)}
                                        className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[#333537] flex items-center gap-2"
                                     >
                                         <TrashIcon /> Delete
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
            )}
        </div>

        {/* Input */}
        <div className="p-3 bg-[#131314] border-t border-[#444746]">
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
                    placeholder={editingMessageId ? "Edit your prompt..." : "Type instructions..."}
                    className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#C4C7C5]"
                    disabled={isSending}
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