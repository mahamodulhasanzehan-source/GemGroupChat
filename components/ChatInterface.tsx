import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ChevronDownIcon, ChevronRightIcon, DotsHorizontalIcon, TrashIcon, PencilIcon, SpeakerIcon, StopCircleIcon } from './Icons';
import { Message, CanvasState, Presence, Group } from '../types';
import { streamGeminiResponse, generateSpeech, subscribeToKeyStatus, setManualKey, TOTAL_KEYS } from '../services/geminiService';
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
  // New props for audio settings
  aiVoice?: string;
  playbackSpeed?: number;
}

// Custom Stop Icon
const StopIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
);

const formatTokenCount = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    currentUser, groupId, 
    aiVoice = 'Charon', playbackSpeed = 1.5 // Defaults if not provided
}) => {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [groupDetails, setGroupDetails] = useState<Group | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // UI State
  const [isCanvasCollapsed, setIsCanvasCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'canvas'>('chat');

  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Presence[]>([]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const [canvasState, setCanvasState] = useState<CanvasState>({ html: '', css: '', js: '', lastUpdated: 0, terminalOutput: [] });
  const [tokenUsage, setTokenUsage] = useState<any>({});
  
  // Audio State
  // Cache stores Blob URLs locally.
  const [audioCache, setAudioCache] = useState<Record<string, string>>({}); 
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [generatingAudioIds, setGeneratingAudioIds] = useState<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Key Management State
  const [keyStatus, setKeyStatus] = useState<{ currentIndex: number, rateLimited: number[] }>({ currentIndex: 0, rateLimited: [] });
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);

  const processingRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    if (!editingMessageId) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [localMessages]);

  useEffect(() => {
      // Subscribe to Token Usage from Firebase
      const unsubscribeUsage = subscribeToTokenUsage((data) => setTokenUsage(data));
      // Subscribe to Key Status from GeminiService
      const unsubscribeKeys = subscribeToKeyStatus((status) => setKeyStatus(status));
      
      return () => {
          unsubscribeUsage();
          unsubscribeKeys();
      };
  }, []);

  useEffect(() => {
      if (!groupId) return;
      
      const unsubscribeGroup = subscribeToGroupDetails(groupId, (details) => {
          setGroupDetails(details);
          if (details && details.processingMessageId === null && abortControllerRef.current) {
               console.log("Processing ID cleared externally, aborting local generation.");
               abortControllerRef.current.abort();
               abortControllerRef.current = null;
               setIsSending(false);
               processingRef.current = null;
          }
      });
      const unsubscribeMsgs = subscribeToMessages(groupId, (msgs) => setLocalMessages(msgs));
      
      const unsubscribeCanvas = subscribeToCanvas(groupId, (data) => {
          if (data) setCanvasState(data);
      });

      const unsubscribePresence = subscribeToPresence(groupId, (users) => setOnlineUsers(users));

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

  // Audio Player Logic
  const handlePlayAudio = async (msgId: string, text: string) => {
      // 1. If playing this message, stop it.
      if (playingMessageId === msgId) {
          if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
          }
          setPlayingMessageId(null);
          return;
      }

      // 2. Stop any other playing audio
      if (audioRef.current) {
          audioRef.current.pause();
          setPlayingMessageId(null);
      }

      // 3. Check Cache
      // Note: We might want to invalidate cache if voice changes, 
      // but for simplicity, we assume cached audio is "fixed" unless page reload.
      // If user wants new voice, they might need to reload or we can add cache key suffix.
      // Let's add voice suffix to cache key to support switching.
      const cacheKey = `${msgId}_${aiVoice}`;
      let url = audioCache[cacheKey];

      // 4. If not in cache, generate it now (On-Demand)
      if (!url) {
          setGeneratingAudioIds(prev => new Set(prev).add(msgId));
          try {
              url = await generateSpeech(text, aiVoice) || '';
              if (url) {
                  setAudioCache(prev => ({ ...prev, [cacheKey]: url }));
              }
          } finally {
              setGeneratingAudioIds(prev => {
                  const next = new Set(prev);
                  next.delete(msgId);
                  return next;
              });
          }
      }

      // 5. Play if we have a URL
      if (url) {
          const audio = new Audio(url);
          audio.playbackRate = playbackSpeed; // Use prop
          audioRef.current = audio;
          audio.onended = () => setPlayingMessageId(null);
          audio.play().catch(e => console.error("Playback failed", e));
          setPlayingMessageId(msgId);
      }
  };

  const extractCode = (text: string) => {
      // Try to match HTML code blocks, capturing even partial content
      const htmlMatch = text.match(/```html\s*([\s\S]*?)(```|$)/i);
      const genericMatch = text.match(/```\s*([\s\S]*?)(```|$)/i);
      let code = null;
      if (htmlMatch) {
          code = htmlMatch[1];
      } else if (genericMatch && (genericMatch[1].includes('<html') || genericMatch[1].includes('<!DOCTYPE'))) {
          code = genericMatch[1];
      }
      return { html: code };
  };

  const prepareOptimizedHistory = (allMessages: Message[], currentMsgId: string) => {
      const fullHistory = allMessages
        .filter(m => m.status !== 'queued' && m.id !== currentMsgId && !hiddenMessageIds.has(m.id))
        .map(m => ({
            role: m.role as 'user' | 'model',
            text: m.role === 'user' ? `[${m.senderName}]: ${m.text}` : m.text,
            originalText: m.text 
        }));

      const MAX_HISTORY = 10;
      if (fullHistory.length <= MAX_HISTORY) {
          return fullHistory.map(m => ({ role: m.role, text: m.text }));
      }

      const recentHistory = fullHistory.slice(-MAX_HISTORY);
      const olderHistory = fullHistory.slice(0, -MAX_HISTORY);

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

  useEffect(() => {
      if (!groupDetails || !groupId || localMessages.length === 0) return;

      const processQueue = async () => {
          const processingId = groupDetails.processingMessageId;
          
          if (processingId) return; 

          const queuedMessages = localMessages.filter(m => m.status === 'queued' && m.role === 'user');
          if (queuedMessages.length === 0) return;

          const nextMsg = queuedMessages[0];

          if (processingRef.current === nextMsg.id) return;

          if (nextMsg.senderId === currentUser.uid) {
              console.log("Processing Queue: My Turn", nextMsg.id);
              processingRef.current = nextMsg.id;
              
              try {
                  await executeGeminiGeneration(nextMsg);
              } finally {
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

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
          await updateGroup(groupId, { processingMessageId: userMsg.id });
          await updateMessage(groupId, userMsg.id, { status: 'generating' });
          setIsSending(true);

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

          const validHistory = prepareOptimizedHistory(localMessages, userMsg.id);
          validHistory.push({ role: 'user', text: `[${userMsg.senderName}]: ${userMsg.text}` });

          let accumulatedText = '';
          
          // Separate throttle timers for smoother updates
          let lastMessageUpdateTime = 0;
          let lastCanvasUpdateTime = 0;
          const MESSAGE_THROTTLE = 150; // Fast chat updates
          const CANVAS_THROTTLE = 600;  // Slower canvas updates to prevent firestore spam

          await streamGeminiResponse(
              userMsg.text,
              validHistory,
              canvasState,
              async (chunk) => {
                  accumulatedText += chunk;
                  
                  const codeUpdates = extractCode(accumulatedText);
                  
                  // Canvas Updates
                  if (codeUpdates.html) {
                       // 1. Optimistic Local Update (Instant)
                       setCanvasState(prev => ({ ...prev, html: codeUpdates.html!, lastUpdated: Date.now() }));
                       
                       // 2. Auto-open canvas if closed and content is generating
                       if (isCanvasCollapsed) setIsCanvasCollapsed(false);

                       // 3. Throttled Firestore Update (Shared State)
                       const now = Date.now();
                       if (now - lastCanvasUpdateTime > CANVAS_THROTTLE) {
                           lastCanvasUpdateTime = now;
                           await updateCanvas(groupId, { html: codeUpdates.html });
                       }
                  }

                  // Message Updates
                  const now = Date.now();
                  if (now - lastMessageUpdateTime > MESSAGE_THROTTLE) {
                      lastMessageUpdateTime = now;
                      await updateMessage(groupId, modelMsgId, { 
                          text: accumulatedText,
                          isLoading: true 
                      });
                  }
              },
              abortController.signal
          );

          // Final update to ensure consistency
          const finalCode = extractCode(accumulatedText);
          if (finalCode.html) {
              await updateCanvas(groupId, { html: finalCode.html });
          }

          await updateMessage(groupId, modelMsgId, { text: accumulatedText, isLoading: false, status: 'done' });
          await updateMessage(groupId, userMsg.id, { status: 'done' });
          
          await updateGroup(groupId, { processingMessageId: null });

          // --- TRIGGER BACKGROUND SPEECH GENERATION ---
          // This runs after text generation is complete to avoid context switching too much
          // Uses Key 5 exclusively.
          console.log("Generating Audio in background...");
          // Pre-set generating status so UI shows spinner immediately
          setGeneratingAudioIds(prev => new Set(prev).add(modelMsgId));
          try {
            // Pass the current selected voice
            const audioUrl = await generateSpeech(accumulatedText, aiVoice);
            if (audioUrl) {
                // Cache with voice key
                const cacheKey = `${modelMsgId}_${aiVoice}`;
                setAudioCache(prev => ({ ...prev, [cacheKey]: audioUrl }));
            }
          } finally {
            setGeneratingAudioIds(prev => {
                const next = new Set(prev);
                next.delete(modelMsgId);
                return next;
            });
          }

      } catch (e: any) {
          console.error("Error generating or Aborted", e);
          if (e.message === "Aborted by user" || e.name === "AbortError") {
              await updateMessage(groupId, userMsg.id, { status: 'done', text: userMsg.text + " [Stopped]" });
          } else {
             await updateMessage(groupId, userMsg.id, { status: 'done', text: userMsg.text + ` [Error: ${e.message}]` });
          }
          await updateGroup(groupId, { processingMessageId: null });
      } finally {
          setIsSending(false);
          abortControllerRef.current = null;
          processingRef.current = null;
      }
  };

  const handleStop = async () => {
      if (!groupId) return;
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
      }
      await updateGroup(groupId, { processingMessageId: null });
      setIsSending(false);
  };

  const handleSend = async () => {
    if (!input.trim() || isSending || !groupId) return;
    
    if (groupDetails?.lockedBy && groupDetails.lockedBy !== currentUser.uid) {
        if (Date.now() - (groupDetails.lockedAt || 0) < 120000) {
            alert("Group is currently locked by another user editing a prompt.");
            return;
        }
    }

    setMobileView('chat'); 

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
           setHiddenMessageIds(prev => new Set(prev).add(msg.id));
      }
  };
  
  // Show ALL messages, including queued ones, so everyone sees them immediately
  const visibleMessages = localMessages.filter(m => !hiddenMessageIds.has(m.id));
  
  // For the status bar logic
  const queuedMessages = localMessages.filter(m => m.status === 'queued' && m.role === 'user');
  
  // Identify who is currently being processed
  const currentProcessingMsg = localMessages.find(m => m.id === groupDetails?.processingMessageId);
  const isSystemBusy = !!groupDetails?.processingMessageId;

  // Key Selection Logic
  const handleKeySelect = (index: number) => {
      setManualKey(index);
      setShowKeyDropdown(false);
  };

  // Generate Key List for UI
  const keyList = Array.from({ length: TOTAL_KEYS }, (_, i) => {
      const usage = tokenUsage[`key_${i}`] || 0;
      const isRateLimited = keyStatus.rateLimited.includes(i);
      const isActive = keyStatus.currentIndex === i;
      const isTTS = i === 4; // Key 5 is index 4
      return { index: i, usage, isRateLimited, isActive, isTTS };
  });

  return (
    <div className="flex h-full bg-[#131314] overflow-hidden">
        
      {/* Left Panel */}
      <div className={`flex flex-col border-r border-[#444746] transition-all duration-300 
            ${mobileView === 'canvas' ? 'hidden md:flex' : 'flex w-full'} 
            ${isCanvasCollapsed ? 'md:w-full max-w-4xl mx-auto md:border-r-0' : 'md:w-[35%] md:min-w-[350px]'}
      `}>
        
        {/* Top Bar */}
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-[#444746] bg-[#131314]">
            <div className="flex items-center gap-2 relative">
                <span className="text-[#E3E3E3] font-medium tracking-tight truncate max-w-[150px]">
                    {groupDetails?.name || 'Chat'}
                </span>
                
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
                 {/* Key Selector Dropdown */}
                 <div className="relative hidden md:block">
                     <button 
                        onClick={() => setShowKeyDropdown(!showKeyDropdown)}
                        className={`flex items-center gap-2 text-xs font-mono border border-[#444746] rounded overflow-hidden shadow-sm hover:border-[#5E5E5E] transition-colors
                            ${keyStatus.rateLimited.includes(keyStatus.currentIndex) ? 'bg-yellow-900/20 border-yellow-700/50' : 'bg-[#1E1F20]'}
                        `}
                     >
                        <div className={`px-2 py-1 border-r border-[#444746] ${keyStatus.rateLimited.includes(keyStatus.currentIndex) ? 'text-yellow-500' : 'bg-[#333537] text-[#A8C7FA]'}`}>
                            Key {keyStatus.currentIndex + 1}
                        </div>
                        <div className="text-[#C4C7C5] px-2 py-1 flex items-center gap-1">
                            {formatTokenCount(tokenUsage[`key_${keyStatus.currentIndex}`] || 0)}
                            <ChevronDownIcon className="w-3 h-3" />
                        </div>
                    </button>

                    {showKeyDropdown && (
                        <div className="absolute top-full right-0 mt-2 w-64 bg-[#1E1F20] border border-[#444746] rounded-lg shadow-xl z-50 overflow-hidden">
                            <div className="py-1">
                                <div className="px-3 py-1 text-[10px] text-[#5E5E5E] uppercase font-bold tracking-wider bg-[#1A1A1C]">Text Generation</div>
                                {keyList.filter(k => !k.isTTS).map((k) => (
                                    <button
                                        key={k.index}
                                        onClick={() => handleKeySelect(k.index)}
                                        className={`w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-[#333537] transition-colors
                                            ${k.isActive ? 'bg-[#333537/50]' : ''}
                                            ${k.isRateLimited ? 'text-yellow-500' : 'text-[#C4C7C5]'}
                                        `}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`w-1.5 h-1.5 rounded-full ${k.isActive ? 'bg-[#4285F4]' : 'bg-transparent'}`}></span>
                                            <span className="font-mono">Key {k.index + 1}</span>
                                            {k.isRateLimited && <span className="text-[10px] bg-yellow-900/30 px-1 rounded border border-yellow-700/50">429</span>}
                                        </div>
                                        <span className="font-mono text-[10px] opacity-70">{formatTokenCount(k.usage)}</span>
                                    </button>
                                ))}
                                
                                <div className="px-3 py-1 text-[10px] text-[#5E5E5E] uppercase font-bold tracking-wider bg-[#1A1A1C] border-t border-[#444746]">Speech (TTS)</div>
                                {keyList.filter(k => k.isTTS).map((k) => (
                                    <div
                                        key={k.index}
                                        className={`w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-[#333537] transition-colors cursor-default text-[#A8C7FA]`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                                            <span className="font-mono">Key {k.index + 1}</span>
                                            {k.isRateLimited && <span className="text-[10px] bg-yellow-900/30 px-1 rounded border border-yellow-700/50">429</span>}
                                        </div>
                                        <span className="font-mono text-[10px] opacity-70">{formatTokenCount(k.usage)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                 </div>

                {/* Mobile: Toggle to Canvas */}
                <button 
                    onClick={() => setMobileView('canvas')}
                    className="md:hidden p-1.5 bg-[#4285F4] text-white rounded-md text-xs font-medium"
                >
                    Canvas &gt;
                </button>

                {/* Desktop: Expand Canvas */}
                {isCanvasCollapsed && (
                    <button 
                        onClick={() => setIsCanvasCollapsed(false)}
                        className="hidden md:flex p-1.5 hover:bg-[#333537] text-[#E3E3E3] rounded-md border border-[#444746]"
                        title="Open Canvas"
                    >
                        <ChevronDownIcon /> 
                        <span className="text-xs ml-1">Canvas</span>
                    </button>
                )}
            </div>
        </div>

        {/* Messages List & Input Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center scroll-smooth relative">
            <div className="w-full space-y-6 pb-4">
                {visibleMessages.map((msg, index) => {
                const isMe = msg.senderId === currentUser.uid;
                const isGemini = msg.role === 'model';
                // ALL user roles go on the right, AI goes on the left
                const isUserRole = msg.role === 'user';
                
                const myMessages = visibleMessages.filter(m => m.senderId === currentUser.uid);
                const isMyLatest = myMessages.length > 0 && myMessages[myMessages.length - 1].id === msg.id;

                const isQueued = msg.status === 'queued';
                
                // Audio Logic
                const isPlaying = playingMessageId === msg.id;
                const isGeneratingAudio = generatingAudioIds.has(msg.id);
                // We show the button if it's a finished AI message
                const showAudioButton = isGemini && !msg.isLoading;

                return (
                    <div 
                        key={msg.id} 
                        className={`group relative flex gap-3 ${isUserRole ? 'flex-row-reverse' : 'flex-row'} animate-[fadeIn_0.3s_ease-out]`}
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
                    
                        <div className={`flex flex-col max-w-[90%] ${isUserRole ? 'items-end' : 'items-start'}`}>
                            {/* Message Bubble */}
                            <div className={`
                                prose prose-invert prose-sm text-[#E3E3E3] leading-relaxed break-words max-w-full rounded-lg px-3 py-2 shadow-sm
                                ${isUserRole ? 'bg-[#1E1F20]' : 'bg-transparent pl-0'}
                                ${isQueued ? 'opacity-50 border border-dashed border-[#444746]' : ''}
                            `}>
                                {isQueued && (
                                    <div className="text-[10px] text-[#A8C7FA] flex items-center gap-2 mb-1">
                                        <div className="w-3 h-3 border-2 border-[#A8C7FA] border-t-transparent rounded-full animate-spin"></div>
                                        <span>Waiting in queue...</span>
                                    </div>
                                )}
                                <ReactMarkdown
                                    components={{
                                    code(props) {
                                        const {children, className, node, ...rest} = props
                                        const match = /language-(\w+)/.exec(className || '')
                                        // "Directly codes in canvas" - Hide large code blocks from chat bubble
                                        if (match) {
                                            return (
                                                <div className="my-1 flex items-center gap-2 p-2 bg-[#1A1A1C] border border-[#444746] rounded text-xs text-[#A8C7FA]">
                                                     <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                                     <span className="font-mono">Canvas Updated ({match[1]})</span>
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
                            
                            {/* Audio Player Button (Visible for all completed AI messages) */}
                            {showAudioButton && (
                                <button
                                    onClick={() => handlePlayAudio(msg.id, msg.text)}
                                    disabled={isGeneratingAudio}
                                    className={`mt-1 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border transition-colors
                                        ${isPlaying 
                                            ? 'bg-[#4285F4] text-white border-[#4285F4]' 
                                            : 'bg-[#1E1F20] text-[#C4C7C5] border-[#444746] hover:text-white'}
                                        ${isGeneratingAudio ? 'opacity-70 cursor-wait' : ''}
                                    `}
                                >
                                    {isGeneratingAudio ? (
                                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                                    ) : isPlaying ? (
                                        <StopCircleIcon />
                                    ) : (
                                        <SpeakerIcon />
                                    )}
                                    <span>{isGeneratingAudio ? 'Generating...' : (isPlaying ? 'Stop' : 'Play')}</span>
                                </button>
                            )}

                        </div>

                        {!isGemini && hoveredMessageId === msg.id && (
                            <div className={`flex items-center opacity-0 group-hover:opacity-100 transition-opacity self-center ${isUserRole ? 'mr-1' : 'ml-1'}`}>
                                <div className="relative group/menu">
                                    <button className="p-1 text-[#C4C7C5] hover:text-white hover:bg-[#333537] rounded">
                                        <DotsHorizontalIcon />
                                    </button>
                                    <div className={`absolute top-0 ${isUserRole ? 'right-full mr-1' : 'left-full ml-1'} bg-[#1E1F20] border border-[#444746] rounded shadow-lg z-10 w-24 overflow-hidden`}>
                                        {isMe && isMyLatest && (
                                            <button 
                                                onClick={() => handleEdit(msg)}
                                                className="w-full text-left px-3 py-2 text-xs text-[#E3E3E3] hover:bg-[#333537] flex items-center gap-2"
                                            >
                                                <PencilIcon /> Edit
                                            </button>
                                        )}
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

        {/* Status Bar - Shows when ANYONE is queued or processing */}
        {(queuedMessages.length > 0 || isSystemBusy) && (
             <div className="bg-[#1A1A1C] border-t border-[#444746] px-4 py-2 flex items-center justify-between z-30">
                 <div className="flex items-center gap-2 text-xs">
                    {isSystemBusy ? (
                         <>
                            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                            <span className="text-[#A8C7FA] font-medium">
                                AI Generating response for {currentProcessingMsg?.senderName || 'Unknown User'}...
                            </span>
                         </>
                    ) : (
                        <>
                             <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                             <span className="text-[#C4C7C5]">
                                {queuedMessages.length} message{queuedMessages.length !== 1 ? 's' : ''} pending processing
                             </span>
                        </>
                    )}
                 </div>
                 {queuedMessages.length > 0 && (
                     <div className="text-[10px] text-[#5E5E5E]">
                         Next: {queuedMessages[0].senderName}
                     </div>
                 )}
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
                    placeholder={editingMessageId ? "Edit your prompt..." : "Type instructions..."}
                    className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#C4C7C5]"
                />
                
                {isSystemBusy ? (
                    <button 
                        onClick={handleStop} 
                        className="p-1.5 bg-[#E3E3E3] text-black rounded-full hover:bg-white hover:scale-105 transition-transform"
                        title="Stop Generating (Accessible by everyone)"
                    >
                        <StopIcon />
                    </button>
                ) : (
                    (input.trim() || editingMessageId) && (
                        <button onClick={handleSend} className="p-1.5 bg-[#A8C7FA] text-[#000] rounded-full hover:scale-105 transition-transform">
                            <SendIcon />
                        </button>
                    )
                )}
            </div>
        </div>
      </div>

      {/* Right Panel */}
      {!isCanvasCollapsed && (
          <div className={`flex-1 h-full flex flex-col min-w-0 
              ${mobileView === 'chat' ? 'hidden md:flex' : 'flex w-full'}`
          }>
             <div className="h-8 bg-[#1E1F20] border-b border-[#444746] flex items-center justify-end px-2">
                 <button 
                    onClick={() => setIsCanvasCollapsed(true)}
                    className="hidden md:block p-1 hover:bg-[#333537] text-[#C4C7C5] rounded"
                    title="Collapse Canvas"
                 >
                     <ChevronRightIcon />
                 </button>
             </div>
             <div className="flex-1 overflow-hidden">
                <Canvas 
                    canvasState={canvasState} 
                    groupId={groupId || 'demo'} 
                    onCloseMobile={() => setMobileView('chat')}
                />
             </div>
          </div>
      )}

    </div>
  );
};

export default ChatInterface;