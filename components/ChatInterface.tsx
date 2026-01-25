import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SendIcon, ChevronDownIcon, ChevronRightIcon, DotsHorizontalIcon, TrashIcon, PencilIcon, SpeakerIcon, StopCircleIcon, MicIcon, XMarkIcon, MenuIcon, CodeBracketIcon, ImageUploadIcon } from './Icons';
import { Message, CanvasState, Presence, Group, UserChatMessage, Attachment } from '../types';
import { streamGeminiResponse, generateSpeech, subscribeToKeyStatus, setManualKey, TOTAL_KEYS, base64ToWav } from '../services/geminiService';
import { 
    subscribeToMessages, sendMessage, updateMessage, deleteMessage,
    subscribeToGroupDetails, subscribeToTokenUsage, updateGroup,
    subscribeToCanvas, updateCanvas, 
    subscribeToPresence, updatePresence, setGroupLock,
    subscribeToUserChat, sendUserChatMessage, deleteUserChatMessage,
    deleteMessageAttachment
} from '../services/firebase';
import { useGroupCall } from '../hooks/useGroupCall';
import ReactMarkdown from 'react-markdown';
import Canvas from './Canvas';

interface ChatInterfaceProps {
  currentUser: any;
  messages: Message[]; 
  setMessages: any;    
  groupId?: string;
  aiVoice?: string;
  playbackSpeed?: number;
  isCanvasCollapsed?: boolean;
  setIsCanvasCollapsed?: (v: boolean) => void;
  onOpenSidebar?: () => void;
}

const StopIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || "w-5 h-5"}>
        <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
);

const PhoneIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || "w-5 h-5"}>
        <path fillRule="evenodd" d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 5.25V4.5z" clipRule="evenodd" />
    </svg>
);

const formatTokenCount = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    currentUser, groupId, 
    aiVoice = 'Charon', playbackSpeed = 1.5,
    isCanvasCollapsed = true, setIsCanvasCollapsed,
    onOpenSidebar
}) => {
  const [input, setInput] = useState('');
  const [userChatInput, setUserChatInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [userChatMessages, setUserChatMessages] = useState<UserChatMessage[]>([]);
  const [groupDetails, setGroupDetails] = useState<Group | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [unreadUserCount, setUnreadUserCount] = useState(0);
  const [hasAIUpdate, setHasAIUpdate] = useState(false);
  
  // Multimodal State
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Context Menu State for Images
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, msgId: string, attIndex: number } | null>(null);

  // Call Logic Extracted to Hook
  const { 
      isInCall, isMuted, visualizerData, remoteStreams, 
      leaveCall, toggleMute, handleCallAction, handleEndForEveryone 
  } = useGroupCall({ currentUser, groupId, groupDetails });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userChatEndRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);
  const userInputRef = useRef<HTMLTextAreaElement>(null);

  // UI State
  const [mobileView, setMobileView] = useState<'chat' | 'canvas'>('chat');
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Presence[]>([]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<'ai' | 'user' | 'both'>('ai');
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasState>({ html: '', css: '', js: '', lastUpdated: 0, terminalOutput: [] });
  const [tokenUsage, setTokenUsage] = useState<any>({});

  // Resizable Sidebar State
  const [sidebarWidth, setSidebarWidth] = useState(450); // Default width in pixels
  const [isDragging, setIsDragging] = useState(false);
  
  // Audio State
  const [audioCache, setAudioCache] = useState<Record<string, string>>({}); 
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [generatingAudioIds, setGeneratingAudioIds] = useState<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Key Management State
  const [keyStatus, setKeyStatus] = useState<{ currentIndex: number, rateLimited: number[] }>({ currentIndex: 0, rateLimited: [] });
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);

  const processingRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = (ref: React.RefObject<HTMLDivElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!editingMessageId) scrollToBottom(messagesEndRef);
  }, [localMessages, chatMode]);

  useEffect(() => {
    scrollToBottom(userChatEndRef);
  }, [userChatMessages, chatMode]);

  // Click away to close context menu
  useEffect(() => {
      const handleClick = () => setContextMenu(null);
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
  }, []);

  // Resizable Logic
  const startResizing = useCallback(() => {
      setIsDragging(true);
  }, []);

  const stopResizing = useCallback(() => {
      setIsDragging(false);
  }, []);

  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
      if (isDragging) {
          const newWidth = mouseMoveEvent.clientX;
          // Constraints: Min 300px, Max 70% of screen width
          if (newWidth > 300 && newWidth < window.innerWidth * 0.7) {
            setSidebarWidth(newWidth);
          }
      }
  }, [isDragging]);

  useEffect(() => {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      return () => {
          window.removeEventListener("mousemove", resize);
          window.removeEventListener("mouseup", stopResizing);
      };
  }, [resize, stopResizing]);


  // --- Notification Logic ---
  useEffect(() => {
      if (chatMode === 'user' || chatMode === 'both') {
          setUnreadUserCount(0);
      }
      if (chatMode === 'ai' || chatMode === 'both') {
          setHasAIUpdate(false);
      }
  }, [chatMode]);

  useEffect(() => {
      if (userChatMessages.length > 0) {
          const lastMsg = userChatMessages[userChatMessages.length - 1];
          if (lastMsg.senderId !== currentUser.uid && chatMode === 'ai') {
              setUnreadUserCount(prev => prev + 1);
          }
      }
  }, [userChatMessages]);

  useEffect(() => {
      if (localMessages.length > 0) {
           const lastMsg = localMessages[localMessages.length - 1];
           if ((lastMsg.role === 'model' || lastMsg.role === 'system') && chatMode === 'user') {
               setHasAIUpdate(true);
           }
      }
  }, [localMessages, canvasState.lastUpdated]);


  useEffect(() => {
      const unsubscribeUsage = subscribeToTokenUsage((data) => setTokenUsage(data));
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
      const unsubscribeUserChat = subscribeToUserChat(groupId, (msgs) => setUserChatMessages(msgs));
      const unsubscribeCanvas = subscribeToCanvas(groupId, (data) => { if (data) setCanvasState(data); });
      const unsubscribePresence = subscribeToPresence(groupId, (users) => setOnlineUsers(users));

      const heartbeat = setInterval(() => { updatePresence(groupId, currentUser); }, 60000); 
      updatePresence(groupId, currentUser); 

      return () => {
          unsubscribeGroup();
          unsubscribeMsgs();
          unsubscribeUserChat();
          unsubscribeCanvas();
          unsubscribePresence();
          clearInterval(heartbeat);
          // leaveCall handles cleanup internally in hook, but redundancy is okay
      };
  }, [groupId, currentUser]);

  // Image Processing
  const processFile = async (file: File): Promise<Attachment | null> => {
      if (!file.type.startsWith('image/')) return null;

      return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
              const img = new Image();
              img.onload = () => {
                  // Compression: Resize to max 1024px dimension, 0.7 quality jpeg
                  const canvas = document.createElement('canvas');
                  let width = img.width;
                  let height = img.height;
                  const maxDim = 1024;
                  
                  if (width > maxDim || height > maxDim) {
                      if (width > height) {
                          height = Math.round((height * maxDim) / width);
                          width = maxDim;
                      } else {
                          width = Math.round((width * maxDim) / height);
                          height = maxDim;
                      }
                  }
                  
                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  ctx?.drawImage(img, 0, 0, width, height);
                  
                  // Get Base64 without prefix
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                  const base64 = dataUrl.split(',')[1];
                  
                  resolve({
                      type: 'image',
                      mimeType: 'image/jpeg',
                      data: base64
                  });
              };
              img.src = e.target?.result as string;
          };
          reader.readAsDataURL(file);
      });
  };

  const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
          setIsDragOver(true);
      }
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
          setIsDragOver(false);
      }
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Needed to allow drop
  };

  const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;
      
      const files = Array.from(e.dataTransfer.files);
      const newAttachments: Attachment[] = [];
      
      for (const file of files) {
          const att = await processFile(file);
          if (att) newAttachments.push(att);
      }
      
      if (newAttachments.length > 0) {
          setPendingAttachments(prev => [...prev, ...newAttachments]);
      }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const newAttachments: Attachment[] = [];

      for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
              const file = items[i].getAsFile();
              if (file) {
                  const att = await processFile(file);
                  if (att) newAttachments.push(att);
              }
          }
      }
      
      if (newAttachments.length > 0) {
          setPendingAttachments(prev => [...prev, ...newAttachments]);
      }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          const files = Array.from(e.target.files);
          const newAttachments: Attachment[] = [];
          
          for (const file of files) {
              const att = await processFile(file);
              if (att) newAttachments.push(att);
          }
          
          if (newAttachments.length > 0) {
              setPendingAttachments(prev => [...prev, ...newAttachments]);
          }
      }
      // Reset input so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
      setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  };


  // Audio Player Logic (TTS)
  const handlePlayAudio = async (msg: Message) => {
      const msgId = msg.id;

      if (playingMessageId === msgId) {
          if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
          }
          setPlayingMessageId(null);
          return;
      }

      if (audioRef.current) {
          audioRef.current.pause();
          setPlayingMessageId(null);
      }

      const cacheKey = `${msgId}_${aiVoice}`;
      let url = audioCache[cacheKey];

      if (!url && msg.audioData) {
          try {
             url = base64ToWav(msg.audioData);
             setAudioCache(prev => ({ ...prev, [cacheKey]: url }));
          } catch(e) {
             console.error("Failed to decode stored audio", e);
          }
      }

      if (!url) {
          setGeneratingAudioIds(prev => new Set(prev).add(msgId));
          try {
              const base64 = await generateSpeech(msg.text, aiVoice) || '';
              if (base64) {
                  if (groupId) {
                      await updateMessage(groupId, msgId, { audioData: base64 });
                  }
                  url = base64ToWav(base64);
                  setAudioCache(prev => ({ ...prev, [cacheKey]: url }));
              }
          } catch (e) {
              alert("Failed to generate speech. Please check Key 5 configuration.");
          } finally {
              setGeneratingAudioIds(prev => {
                  const next = new Set(prev);
                  next.delete(msgId);
                  return next;
              });
          }
      }

      if (url) {
          const audio = new Audio(url);
          audio.playbackRate = playbackSpeed; 
          audioRef.current = audio;
          audio.onended = () => setPlayingMessageId(null);
          audio.play().catch(e => console.error("Playback failed", e));
          setPlayingMessageId(msgId);
      }
  };

  const extractCodeOrPatch = (accumulatedText: string, currentHtml: string) => {
      // 1. Check for Patch Pattern: <<<<SEARCH ... ==== ... >>>>
      const patchRegex = /<<<<SEARCH\n([\s\S]*?)\n====\n([\s\S]*?)\n>>>>/g;
      let newHtml = currentHtml;
      let hasPatch = false;

      let match;
      while ((match = patchRegex.exec(accumulatedText)) !== null) {
          const searchBlock = match[1];
          const replaceBlock = match[2];
          
          if (newHtml.includes(searchBlock)) {
              newHtml = newHtml.replace(searchBlock, replaceBlock);
              hasPatch = true;
          } else {
              // Simple fallback: If whitespace mismatch, try ignoring trim
              const looseSearch = searchBlock.trim();
              const looseReplace = replaceBlock.trim();
              // This is a naive fallback; proper robust patching needs diff-match-patch library
              // but standard replace covers 90% of "Copilot/Windsurf" style deterministic edits.
              console.warn("Patch Match Warning: Exact block not found. Trying loose match.");
          }
      }

      if (hasPatch) return { html: newHtml, type: 'patch' };

      // 2. Check for Full Code Block
      const htmlMatch = accumulatedText.match(/```html\s*([\s\S]*?)(```|$)/i);
      const genericMatch = accumulatedText.match(/```\s*([\s\S]*?)(```|$)/i);
      
      let code = null;
      if (htmlMatch) {
          code = htmlMatch[1];
      } else if (genericMatch && (genericMatch[1].includes('<html') || genericMatch[1].includes('<!DOCTYPE'))) {
          code = genericMatch[1];
      }

      if (code) return { html: code, type: 'full' };

      return { html: null, type: null };
  };

  const prepareOptimizedHistory = (allMessages: Message[], currentMsgId: string) => {
      const fullHistory = allMessages
        .filter(m => m.status !== 'queued' && m.id !== currentMsgId && !hiddenMessageIds.has(m.id))
        .map(m => ({
            role: m.role as 'user' | 'model',
            text: m.role === 'user' ? `[${m.senderName}]: ${m.text}` : m.text,
            attachments: m.attachments, // Include attachments in history
            originalText: m.text 
        }));

      const MAX_HISTORY = 10;
      if (fullHistory.length <= MAX_HISTORY) {
          return fullHistory.map(m => ({ role: m.role, text: m.text, attachments: m.attachments }));
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

      return [summaryMsg, ...recentHistory.map(m => ({ role: m.role, text: m.text, attachments: m.attachments }))];
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

          // Prepare history including the current message with its attachments
          const validHistory = prepareOptimizedHistory(localMessages, userMsg.id);
          
          validHistory.push({ 
              role: 'user', 
              text: `[${userMsg.senderName}]: ${userMsg.text}`,
              attachments: userMsg.attachments 
          });

          let accumulatedText = '';
          let lastMessageUpdateTime = 0;
          let lastCanvasUpdateTime = 0;
          let currentCanvasHtml = canvasState.html || '';
          
          const MESSAGE_THROTTLE = 150; 
          const CANVAS_THROTTLE = 800;  

          await streamGeminiResponse(
              userMsg.text,
              validHistory,
              canvasState,
              async (chunk) => {
                  accumulatedText += chunk;
                  
                  // Smart Edit Logic
                  const updates = extractCodeOrPatch(accumulatedText, currentCanvasHtml);
                  
                  if (updates.html && updates.html !== currentCanvasHtml) {
                       currentCanvasHtml = updates.html!; // Keep tracking locally for subsequent patches in same stream
                       
                       setCanvasState(prev => ({ ...prev, html: updates.html!, lastUpdated: Date.now() }));
                       if (isCanvasCollapsed && setIsCanvasCollapsed) setIsCanvasCollapsed(false);

                       const now = Date.now();
                       if (now - lastCanvasUpdateTime > CANVAS_THROTTLE) {
                           lastCanvasUpdateTime = now;
                           await updateCanvas(groupId, { html: updates.html });
                       }
                  }

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

          // Final Check
          const finalUpdates = extractCodeOrPatch(accumulatedText, canvasState.html);
          if (finalUpdates.html) {
              await updateCanvas(groupId, { html: finalUpdates.html });
          }

          await updateMessage(groupId, modelMsgId, { text: accumulatedText, isLoading: false, status: 'done' });
          await updateMessage(groupId, userMsg.id, { status: 'done' });
          await updateGroup(groupId, { processingMessageId: null });

          console.log("Generating Audio in background...");
          setGeneratingAudioIds(prev => new Set(prev).add(modelMsgId));
          try {
            const base64 = await generateSpeech(accumulatedText, aiVoice);
            if (base64) {
                await updateMessage(groupId, modelMsgId, { audioData: base64 });
                const url = base64ToWav(base64);
                const cacheKey = `${modelMsgId}_${aiVoice}`;
                setAudioCache(prev => ({ ...prev, [cacheKey]: url }));
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

  const resetTextareaHeight = (ref: React.RefObject<HTMLTextAreaElement>) => {
    if (ref.current) {
        ref.current.style.height = 'auto';
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && pendingAttachments.length === 0) || !groupId) return;
    
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
             await updateMessage(groupId, editingMessageId, { text: input }); // Editing doesn't support changing images yet
             await setGroupLock(groupId, null);
             setEditingMessageId(null);
        } else {
            const userMsgId = Date.now().toString();
            await sendMessage(groupId, {
                id: userMsgId,
                text: input,
                senderId: currentUser.uid,
                senderName: senderDisplayName,
                role: 'user',
                attachments: pendingAttachments
            });
        }
        setInput('');
        setPendingAttachments([]);
        resetTextareaHeight(aiInputRef);
    } catch (e) {
        console.error("Error sending", e);
    }
  };

  const handleUserChatSend = async () => {
      if (!userChatInput.trim() || !groupId) return;
      try {
          await sendUserChatMessage(groupId, {
              text: userChatInput,
              senderId: currentUser.uid,
              senderName: currentUser.displayName || 'Guest',
              photoURL: currentUser.photoURL
          });
          setUserChatInput('');
          resetTextareaHeight(userInputRef);
      } catch (e) {
          console.error("Error sending user chat", e);
      }
  };

  const handleUserChatDelete = async (msgId: string) => {
    if (confirm("Delete this message?")) {
        await deleteUserChatMessage(groupId!, msgId);
    }
  };

  // Helper for auto-expanding textarea
  const adjustHeight = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      e.target.style.height = 'auto';
      e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, type: 'ai' | 'user' = 'ai') => {
    // Enter without Shift/Ctrl sends
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      if (type === 'ai') handleSend();
      else handleUserChatSend();
    }
    // Shift+Enter or Ctrl+Enter will perform default behavior (newline) which is handled by textarea natively
  };

  const handleEdit = async (msg: Message) => {
      await setGroupLock(groupId!, currentUser.uid);
      setEditingMessageId(msg.id);
      setInput(msg.text);
      // Timeout to allow state update before resizing
      setTimeout(() => {
        if (aiInputRef.current) {
            aiInputRef.current.style.height = 'auto';
            aiInputRef.current.style.height = `${aiInputRef.current.scrollHeight}px`;
            aiInputRef.current.focus();
        }
      }, 0);

      if (chatMode !== 'both') setChatMode('ai');
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

  const handleImageContextMenu = (e: React.MouseEvent, msgId: string, index: number) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, msgId, attIndex: index });
  };

  const handleDeleteImage = async () => {
      if (contextMenu && groupId) {
          await deleteMessageAttachment(groupId, contextMenu.msgId, contextMenu.attIndex);
          setContextMenu(null);
      }
  };
  
  const visibleMessages = localMessages.filter(m => !hiddenMessageIds.has(m.id));
  const queuedMessages = localMessages.filter(m => m.status === 'queued' && m.role === 'user');
  const currentProcessingMsg = localMessages.find(m => m.id === groupDetails?.processingMessageId);
  const isSystemBusy = !!groupDetails?.processingMessageId;

  const handleKeySelect = (index: number) => {
      setManualKey(index);
      setShowKeyDropdown(false);
  };

  const keyList = Array.from({ length: TOTAL_KEYS }, (_, i) => {
      const usage = tokenUsage[`key_${i}`] || 0;
      const isRateLimited = keyStatus.rateLimited.includes(i);
      const isActive = keyStatus.currentIndex === i;
      const isTTS = i === 4; 
      return { index: i, usage, isRateLimited, isActive, isTTS };
  });

  // --- Render Helpers ---

  const cleanDisplayText = (text: string) => {
      // Hide raw SEARCH/REPLACE blocks from the UI to prevent clutter
      return text.replace(/<<<<SEARCH\n[\s\S]*?\n====\n[\s\S]*?\n>>>>/g, '\n\n`⚡ Patch Applied to Canvas`\n\n');
  };

  const renderAIChat = (isCompact: boolean) => (
      <div className="flex flex-col h-full relative">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center scroll-smooth relative">
            {/* Removed max-w-5xl mx-auto to fix black bars layout issue */}
            <div className="w-full space-y-6 pb-4 px-4">
                {visibleMessages.map((msg, index) => {
                const isMe = msg.senderId === currentUser.uid;
                const isGemini = msg.role === 'model';
                const isUserRole = msg.role === 'user';
                const myMessages = visibleMessages.filter(m => m.senderId === currentUser.uid);
                const isMyLatest = myMessages.length > 0 && myMessages[myMessages.length - 1].id === msg.id;
                const isQueued = msg.status === 'queued';
                const isPlaying = playingMessageId === msg.id;
                const isGeneratingAudio = generatingAudioIds.has(msg.id);
                const showAudioButton = isGemini && !msg.isLoading;

                const displayText = isGemini ? cleanDisplayText(msg.text) : msg.text;

                return (
                    <div 
                        key={msg.id} 
                        className={`group relative flex gap-3 ${isUserRole ? 'flex-row-reverse' : 'flex-row'} smooth-transition animate-fade-in`}
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
                            {/* Images for User Messages */}
                            {msg.attachments && msg.attachments.length > 0 && (
                                <div className={`flex flex-wrap gap-2 mb-2 ${isUserRole ? 'justify-end' : 'justify-start'}`}>
                                    {msg.attachments.map((att, i) => (
                                        <div 
                                            key={i} 
                                            className="relative rounded-lg overflow-hidden border border-[#444746] cursor-context-menu"
                                            onContextMenu={(e) => handleImageContextMenu(e, msg.id, i)}
                                        >
                                            <img 
                                                src={`data:${att.mimeType};base64,${att.data}`} 
                                                alt="Attachment" 
                                                className="max-h-48 max-w-[200px] object-cover"
                                            />
                                            {/* Hint overlay on hover to show it's interactable */}
                                            <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors pointer-events-none"></div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className={`
                                prose prose-invert prose-sm text-[#E3E3E3] leading-relaxed break-words max-w-full rounded-lg px-3 py-2 shadow-sm smooth-transition
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
                                    {displayText}
                                </ReactMarkdown>
                            </div>
                            
                            {showAudioButton && (
                                <button
                                    onClick={() => handlePlayAudio(msg)}
                                    disabled={isGeneratingAudio}
                                    className={`mt-1 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border smooth-transition
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
                            <div className={`flex items-center opacity-0 group-hover:opacity-100 smooth-transition self-center ${isUserRole ? 'mr-1' : 'ml-1'}`}>
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

        {/* Image Context Menu */}
        {contextMenu && (
            <div 
                className="fixed z-50 bg-[#1E1F20] border border-[#444746] rounded-lg shadow-xl py-1 w-32 animate-fade-in"
                style={{ top: contextMenu.y, left: contextMenu.x }}
            >
                <button 
                    onClick={handleDeleteImage}
                    className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[#333537] flex items-center gap-2"
                >
                    <TrashIcon className="w-4 h-4" /> Delete Image
                </button>
            </div>
        )}

        {(queuedMessages.length > 0 || isSystemBusy) && (
             <div className="bg-[#1A1A1C] border-t border-[#444746] px-4 py-2 flex items-center justify-between z-30 smooth-transition">
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

        {/* Input Area */}
        <div className={`bg-[#131314] border-t border-[#444746] z-30 ${isCompact ? 'p-1' : 'p-3'} relative`}>
            {editingMessageId && (
                <div className="text-xs text-[#A8C7FA] mb-1 flex justify-between">
                    <span>Editing...</span>
                    <button onClick={() => { setEditingMessageId(null); setInput(''); setGroupLock(groupId!, null); }} className="hover:underline">Cancel</button>
                </div>
            )}

            {/* Drag & Drop Overlay */}
            {isDragOver && (
                <div className="absolute inset-0 z-40 bg-[#4285F4]/20 border-2 border-dashed border-[#4285F4] rounded-lg flex items-center justify-center backdrop-blur-sm m-3 pointer-events-none">
                    <span className="text-[#4285F4] font-medium text-sm">Drop images here</span>
                </div>
            )}

            {/* Pending Attachments Preview */}
            {pendingAttachments.length > 0 && (
                <div className="flex items-center gap-2 px-3 pb-2 overflow-x-auto">
                    {pendingAttachments.map((att, i) => (
                        <div key={i} className="relative group shrink-0">
                            <div className="w-16 h-16 rounded-md border border-[#444746] overflow-hidden">
                                <img src={`data:${att.mimeType};base64,${att.data}`} className="w-full h-full object-cover" alt="preview" />
                            </div>
                            <button 
                                onClick={() => removeAttachment(i)}
                                className="absolute -top-1.5 -right-1.5 bg-[#1E1F20] text-white rounded-full p-0.5 border border-[#444746] hover:bg-red-500"
                            >
                                <XMarkIcon className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div 
                className={`bg-[#1E1F20] rounded-3xl flex items-end px-3 gap-2 border smooth-transition ${isCompact ? 'py-1' : 'py-2'} 
                ${editingMessageId ? 'border-[#4285F4]' : 'border-transparent focus-within:border-[#444746]'}
                ${isDragOver ? 'border-[#4285F4]' : ''}
                `}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                {/* File Input Button */}
                <div className="pb-1.5">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 rounded-full text-[#C4C7C5] hover:text-white hover:bg-[#333537] smooth-transition"
                        title="Upload Image"
                    >
                        <ImageUploadIcon className="w-5 h-5" />
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="image/*" 
                        multiple 
                        onChange={handleFileSelect}
                    />
                </div>

                <textarea 
                    ref={aiInputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => {
                        setInput(e.target.value);
                        adjustHeight(e);
                    }}
                    onKeyDown={(e) => handleKeyDown(e, 'ai')}
                    onPaste={handlePaste}
                    placeholder={editingMessageId ? "Edit prompt..." : (pendingAttachments.length > 0 ? "Describe the image..." : "Ask Gemini or drag image here...")}
                    className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#C4C7C5] resize-none overflow-hidden max-h-32 py-2"
                />
                
                <div className="pb-1.5">
                {isSystemBusy && !input.trim() && pendingAttachments.length === 0 ? (
                    <button 
                        onClick={handleStop} 
                        className="p-1.5 bg-[#E3E3E3] text-black rounded-full hover:bg-white hover:scale-105 smooth-transition transform"
                        title="Stop Generating"
                    >
                        <StopIcon />
                    </button>
                ) : (
                     // Persistent Send Icon (Gray when empty, Blue when has text)
                    <button 
                        onClick={handleSend}
                        disabled={(!input.trim() && pendingAttachments.length === 0) && !editingMessageId}
                        className={`p-1.5 rounded-full smooth-transition transform ${
                            (input.trim() || pendingAttachments.length > 0 || editingMessageId)
                            ? 'bg-[#A8C7FA] text-[#000] hover:scale-105' 
                            : 'bg-transparent text-[#444746] cursor-default'
                        }`}
                    >
                        <SendIcon />
                    </button>
                )}
                </div>
            </div>
        </div>
      </div>
  );

  const renderUserChat = (isCompact: boolean) => (
      <div className="flex flex-col h-full relative bg-[#18181a]">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col scroll-smooth relative">
              {userChatMessages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-[#5E5E5E] text-sm italic opacity-50">
                      <p>Start chatting with the group!</p>
                  </div>
              ) : (
                  <div className="w-full space-y-3 pb-4">
                      {userChatMessages.map((msg) => {
                          const isMe = msg.senderId === currentUser.uid;
                          return (
                              <div key={msg.id} className={`flex gap-3 animate-fade-in group/msg ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0 overflow-hidden border border-[#444746]">
                                      {msg.photoURL ? (
                                          <img src={msg.photoURL} alt={msg.senderName} className="w-full h-full object-cover" />
                                      ) : (
                                          <span className="text-xs font-bold text-white">{msg.senderName[0]}</span>
                                      )}
                                  </div>
                                  <div className={`flex flex-col max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
                                      <div className={`text-[10px] mb-1 ${isMe ? 'text-[#A8C7FA]' : 'text-[#C4C7C5]'}`}>
                                          {msg.senderName}
                                      </div>
                                      
                                      <div className="flex items-center gap-2">
                                         {/* Delete Button for User's own messages */}
                                         {isMe && (
                                             <button 
                                                 onClick={() => handleUserChatDelete(msg.id)}
                                                 className="opacity-0 group-hover/msg:opacity-100 p-1 text-[#C4C7C5] hover:text-red-400 transition-opacity"
                                                 title="Delete message"
                                             >
                                                 <TrashIcon className="w-4 h-4" />
                                             </button>
                                         )}

                                         <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed break-words shadow-sm ${
                                              isMe ? 'bg-[#4285F4] text-white rounded-tr-none' : 'bg-[#2A2B2D] text-[#E3E3E3] rounded-tl-none border border-[#444746]'
                                          }`}>
                                              {msg.text}
                                         </div>
                                      </div>
                                  </div>
                              </div>
                          );
                      })}
                      <div ref={userChatEndRef} />
                  </div>
              )}
          </div>

          <div className={`bg-[#18181a] border-t border-[#444746] z-30 ${isCompact ? 'p-1' : 'p-3'}`}>
              
              {/* Join Call Banner */}
              {!isInCall && groupDetails?.isCallActive && (
                  <div className="mb-2 bg-[#2A2B2D] border border-[#4285F4] rounded-lg p-2 flex items-center justify-between animate-fade-in">
                      <div className="flex items-center gap-2 text-xs text-[#E3E3E3]">
                           <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                           <span>Join the call</span>
                      </div>
                      <button 
                          onClick={handleCallAction}
                          className="px-3 py-1 bg-[#4285F4] text-white text-xs font-medium rounded-md hover:bg-[#3367D6]"
                      >
                          Join
                      </button>
                  </div>
              )}

              {/* In Call Visualizer Pill - Half Height/Width */}
              {isInCall && (
                  <div className="mb-2 w-full flex justify-center">
                    <div className="bg-[#2A2B2D] border border-[#444746] rounded-full px-3 py-1 flex items-center justify-between gap-4 shadow-lg h-8">
                        {/* Audio Visualizer (Left) */}
                        <div className="flex items-end gap-0.5 h-3 w-10 justify-center">
                            {visualizerData.map((val, i) => (
                                <div 
                                    key={i} 
                                    className="w-1 bg-[#4285F4] rounded-full transition-all duration-75"
                                    style={{ height: `${Math.min(100, val)}%` }}
                                ></div>
                            ))}
                        </div>

                        {/* Controls (Right) */}
                        <div className="flex items-center gap-1.5">
                             <button 
                                onClick={toggleMute}
                                className={`p-1 rounded-full ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-[#333537] text-[#C4C7C5] hover:text-white'}`}
                             >
                                 <MicIcon className="w-3 h-3" />
                             </button>
                             <button 
                                onClick={leaveCall}
                                className="p-1 rounded-full bg-red-600 text-white hover:bg-red-500"
                                title="Leave Call"
                             >
                                 <XMarkIcon className="w-3 h-3" />
                             </button>
                             
                             {/* Admin End Call Button */}
                             {groupDetails?.callStartedBy === currentUser.uid && (
                                <button
                                    onClick={handleEndForEveryone}
                                    className="p-1 rounded-full bg-[#E3E3E3] text-red-600 hover:bg-white border border-red-500"
                                    title="End Call for Everyone"
                                >
                                    <StopIcon className="w-3 h-3" />
                                </button>
                             )}
                        </div>
                    </div>
                  </div>
              )}

              {/* Hidden Audio Elements for Remote Streams */}
              {remoteStreams.map((stream, idx) => (
                  <audio 
                    key={idx} 
                    autoPlay 
                    playsInline
                    controls={false}
                    ref={audioEl => {
                        if (audioEl) audioEl.srcObject = stream;
                    }} 
                  />
              ))}

              <div className={`bg-[#2A2B2D] rounded-3xl flex items-end px-3 gap-2 border border-transparent focus-within:border-[#5E5E5E] smooth-transition ${isCompact ? 'py-1' : 'py-2'}`}>
                  {/* Call Button - Changed Logic to Join if call active */}
                  <div className="pb-1.5">
                  <button 
                      onClick={handleCallAction}
                      disabled={isInCall}
                      className={`p-1.5 rounded-full smooth-transition ${
                          isInCall ? 'opacity-50 cursor-not-allowed text-[#C4C7C5]' : 
                          groupDetails?.isCallActive ? 'bg-green-600 text-white hover:bg-green-500' : 
                          'text-[#C4C7C5] hover:text-green-400 hover:bg-[#333537]'
                      }`}
                      title={groupDetails?.isCallActive ? "Join Call" : "Start Call"}
                  >
                      <PhoneIcon className="w-5 h-5" />
                  </button>
                  </div>

                  <textarea 
                      ref={userInputRef}
                      rows={1}
                      value={userChatInput}
                      onChange={(e) => {
                          setUserChatInput(e.target.value);
                          adjustHeight(e);
                      }}
                      onKeyDown={(e) => handleKeyDown(e, 'user')}
                      placeholder="Message the group..."
                      className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#5E5E5E] resize-none overflow-hidden max-h-32 py-2"
                  />
                  
                  {/* Persistent Send Icon */}
                  <div className="pb-1.5">
                  <button 
                      onClick={handleUserChatSend} 
                      disabled={!userChatInput.trim()}
                      className={`p-1.5 rounded-full smooth-transition transform ${
                          userChatInput.trim()
                          ? 'bg-[#4285F4] text-white hover:scale-105'
                          : 'bg-transparent text-[#5E5E5E] cursor-default'
                      }`}
                  >
                      <SendIcon />
                  </button>
                  </div>
              </div>
          </div>
      </div>
  );

  return (
    <div className="flex h-full bg-[#131314] overflow-hidden smooth-transition relative">
        
      {/* Left Panel (Main Content) */}
      <div 
        className={`flex flex-col border-r border-[#444746] smooth-transition duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)]
            ${mobileView === 'canvas' ? 'hidden md:flex' : 'flex'}
            ${isCanvasCollapsed ? 'w-full' : ''}
        `}
        style={!isCanvasCollapsed && window.innerWidth >= 768 ? { width: sidebarWidth } : {}}
      >
        
        {/* Top Bar */}
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-[#444746] bg-[#131314]">
            
            {/* Mobile Sidebar Toggle (Left Button) */}
            <button 
                onClick={onOpenSidebar}
                className="md:hidden p-1.5 mr-2 text-[#C4C7C5] hover:text-white"
            >
                <MenuIcon />
            </button>

            <div className="flex items-center gap-3 relative min-w-0 flex-1">
                <span className="text-[#E3E3E3] font-medium tracking-tight truncate max-w-[100px] shrink-0">
                    {groupDetails?.name || 'Chat'}
                </span>

                {/* Mode Toggle Slider */}
                <div className="relative bg-[#1E1F20] rounded-full p-0.5 flex border border-[#444746] shrink-0">
                    {/* Notification Dots */}
                    {hasAIUpdate && (chatMode === 'user') && (
                        <div className="absolute -top-1 left-[15%] w-2.5 h-2.5 bg-[#4285F4] rounded-full border border-[#1E1F20] z-20 animate-pulse"></div>
                    )}
                    {unreadUserCount > 0 && (chatMode === 'ai') && (
                        <div className="absolute -top-1 left-[50%] w-3.5 h-3.5 bg-red-500 rounded-full border border-[#1E1F20] z-20 flex items-center justify-center text-[8px] font-bold text-white">
                            {unreadUserCount > 9 ? '9+' : unreadUserCount}
                        </div>
                    )}

                    <div 
                        className="absolute top-0.5 bottom-0.5 bg-[#444746] rounded-full transition-all duration-300 ease-in-out"
                        style={{
                            left: chatMode === 'ai' ? '2px' : chatMode === 'user' ? '33.3%' : '66.6%',
                            width: '32%',
                            marginLeft: chatMode === 'ai' ? 0 : chatMode === 'user' ? 0 : '1px'
                        }}
                    ></div>
                    <button 
                        onClick={() => setChatMode('ai')}
                        className={`relative px-3 py-1 text-[10px] font-medium rounded-full transition-colors z-10 ${chatMode === 'ai' ? 'text-white' : 'text-[#C4C7C5] hover:text-[#E3E3E3]'}`}
                    >
                        AI
                    </button>
                    <button 
                        onClick={() => setChatMode('user')}
                        className={`relative px-3 py-1 text-[10px] font-medium rounded-full transition-colors z-10 ${chatMode === 'user' ? 'text-white' : 'text-[#C4C7C5] hover:text-[#E3E3E3]'}`}
                    >
                        Users
                    </button>
                    <button 
                        onClick={() => setChatMode('both')}
                        className={`relative px-3 py-1 text-[10px] font-medium rounded-full transition-colors z-10 ${chatMode === 'both' ? 'text-white' : 'text-[#C4C7C5] hover:text-[#E3E3E3]'}`}
                    >
                        Both
                    </button>
                </div>
                
                <div className="relative ml-auto">
                    <button 
                        onClick={() => setShowOnlineUsers(!showOnlineUsers)}
                        className="flex items-center gap-1 text-xs text-[#C4C7C5] hover:text-white bg-[#1E1F20] px-2 py-1 rounded-full border border-[#444746] smooth-transition"
                    >
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        {onlineUsers.length}
                    </button>
                    {showOnlineUsers && (
                        <div className="absolute top-full right-0 mt-2 w-48 bg-[#1E1F20] border border-[#444746] rounded-lg shadow-xl z-50 overflow-hidden smooth-transition animate-fade-in">
                            <div className="max-h-40 overflow-y-auto">
                                {onlineUsers.map(u => (
                                    <div key={u.uid} className="px-3 py-2 text-xs text-[#C4C7C5] flex items-center gap-2 hover:bg-[#333537] smooth-transition">
                                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                        {u.displayName}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="flex items-center gap-2 ml-2">
                 {/* Key Selector Dropdown */}
                 <div className="relative hidden md:block">
                     <button 
                        onClick={() => setShowKeyDropdown(!showKeyDropdown)}
                        className={`flex items-center gap-2 text-xs font-mono border border-[#444746] rounded overflow-hidden shadow-sm hover:border-[#5E5E5E] smooth-transition
                            ${keyStatus.rateLimited.includes(keyStatus.currentIndex) ? 'bg-yellow-900/20 border-yellow-700/50' : 'bg-[#1E1F20]'}
                        `}
                     >
                        <div className={`px-2 py-1 border-r border-[#444746] ${keyStatus.rateLimited.includes(keyStatus.currentIndex) ? 'text-yellow-500' : 'bg-[#333537] text-[#A8C7FA]'}`}>
                            Key {keyStatus.currentIndex + 1}
                        </div>
                    </button>

                    {showKeyDropdown && (
                        <div className="absolute top-full right-0 mt-2 w-64 bg-[#1E1F20] border border-[#444746] rounded-lg shadow-xl z-50 overflow-hidden smooth-transition animate-fade-in">
                            <div className="py-1">
                                <div className="px-3 py-1 text-[10px] text-[#5E5E5E] uppercase font-bold tracking-wider bg-[#1A1A1C]">Text Generation</div>
                                {keyList.filter(k => !k.isTTS).map((k) => (
                                    <button
                                        key={k.index}
                                        onClick={() => handleKeySelect(k.index)}
                                        className={`w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-[#333537] smooth-transition
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

                                <div className="px-3 py-1 text-[10px] text-[#5E5E5E] uppercase font-bold tracking-wider bg-[#1A1A1C] mt-1">Speech (TTS)</div>
                                {keyList.filter(k => k.isTTS).map((k) => (
                                    <button
                                        key={k.index}
                                        onClick={() => handleKeySelect(k.index)}
                                        className={`w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-[#333537] smooth-transition
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
                            </div>
                        </div>
                    )}
                 </div>

                {/* Mobile: Toggle to Canvas (Right Button) */}
                <button 
                    onClick={() => setMobileView('canvas')}
                    className="md:hidden p-1.5 ml-2 text-[#C4C7C5] hover:text-white"
                >
                    <CodeBracketIcon />
                </button>

                {/* Desktop: Expand Canvas */}
                {isCanvasCollapsed && setIsCanvasCollapsed && (
                    <button 
                        onClick={() => setIsCanvasCollapsed(false)}
                        className="hidden md:flex p-1.5 hover:bg-[#333537] text-[#E3E3E3] rounded-md border border-[#444746] smooth-transition"
                        title="Open Canvas"
                    >
                        <ChevronDownIcon /> 
                        <span className="text-xs ml-1">Canvas</span>
                    </button>
                )}
            </div>
        </div>

        {/* --- Main Content Area based on Mode --- */}
        <div className="flex-1 flex flex-col min-h-0 relative group">
            <div className={`h-full flex flex-col ${isCanvasCollapsed ? 'w-full max-w-5xl mx-auto' : 'w-full'}`}>
                {chatMode === 'ai' && (
                    renderAIChat(false)
                )}
                {chatMode === 'user' && (
                    renderUserChat(false)
                )}
                {chatMode === 'both' && (
                    <div className="flex flex-col h-full">
                        <div className="h-[50%] flex flex-col min-h-0 border-b border-[#444746]">
                            {renderAIChat(true)}
                        </div>
                        <div className="h-[50%] flex flex-col min-h-0">
                            {renderUserChat(true)}
                        </div>
                    </div>
                )}
            </div>
        </div>

      </div>

      {/* Resizable Divider - Only visible on Desktop when Canvas is Open */}
      {!isCanvasCollapsed && (
         <div 
            className="hidden md:flex w-1 h-full bg-[#131314] hover:bg-[#4285F4] cursor-col-resize items-center justify-center transition-colors delay-150 group z-50 resizer-handle"
            onMouseDown={startResizing}
         >
             <div className="w-0.5 h-8 bg-[#444746] rounded-full group-hover:bg-white transition-colors"></div>
         </div>
      )}

      {/* Right Panel (Canvas) - Desktop - ALWAYS MOUNTED for Smooth Transition */}
      <div className={`hidden md:flex flex-col transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] h-full overflow-hidden border-l border-[#444746]
            ${isCanvasCollapsed ? 'w-0 opacity-0 border-l-0' : 'flex-1 opacity-100'}
      `}>
         <div className="h-8 bg-[#1E1F20] border-b border-[#444746] flex items-center justify-end px-2 shrink-0">
             <button 
                onClick={() => setIsCanvasCollapsed && setIsCanvasCollapsed(true)}
                className="hidden md:block p-1 hover:bg-[#333537] text-[#C4C7C5] rounded smooth-transition"
                title="Collapse Canvas"
             >
                 <ChevronRightIcon />
             </button>
         </div>
         <div className="flex-1 overflow-hidden">
            <Canvas 
                canvasState={canvasState} 
                groupId={groupId || 'demo'} 
            />
         </div>
      </div>

      {/* Mobile Canvas Overlay - Optimized for GPU Animation */}
      <div 
        className={`md:hidden fixed inset-0 z-50 bg-[#1E1F20] smooth-transition ${mobileView === 'canvas' ? 'slide-up-enter-active' : 'slide-up-enter'}`}
        style={{ transitionDuration: '0.6s' }}
      >
          <Canvas 
             canvasState={canvasState} 
             groupId={groupId || 'demo'} 
             onCloseMobile={() => setMobileView('chat')}
          />
      </div>

    </div>
  );
};

export default ChatInterface;