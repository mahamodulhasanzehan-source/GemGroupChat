import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ChevronDownIcon, ChevronRightIcon, DotsHorizontalIcon, TrashIcon, PencilIcon, SpeakerIcon, StopCircleIcon, MicIcon, XMarkIcon } from './Icons';
import { Message, CanvasState, Presence, Group, UserChatMessage } from '../types';
import { streamGeminiResponse, generateSpeech, subscribeToKeyStatus, setManualKey, TOTAL_KEYS, base64ToWav } from '../services/geminiService';
import { 
    subscribeToMessages, sendMessage, updateMessage, deleteMessage,
    subscribeToGroupDetails, subscribeToTokenUsage, updateGroup,
    subscribeToCanvas, updateCanvas, 
    subscribeToPresence, updatePresence, setGroupLock,
    subscribeToUserChat, sendUserChatMessage, deleteUserChatMessage,
    setGroupCallState, joinCallSession, leaveCallSession, endGroupCall
} from '../services/firebase';
import ReactMarkdown from 'react-markdown';
import Canvas from './Canvas';
import Peer from 'peerjs';

interface ChatInterfaceProps {
  currentUser: any;
  messages: Message[]; 
  setMessages: any;    
  groupId?: string;
  aiVoice?: string;
  playbackSpeed?: number;
  isCanvasCollapsed?: boolean;
  setIsCanvasCollapsed?: (v: boolean) => void;
}

// Fix: Update StopIcon to accept className prop to avoid type errors and remove duplicate definition
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
    isCanvasCollapsed = true, setIsCanvasCollapsed
}) => {
  // Input states
  const [input, setInput] = useState('');
  const [userChatInput, setUserChatInput] = useState('');

  // Messages State
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [userChatMessages, setUserChatMessages] = useState<UserChatMessage[]>([]);
  
  const [groupDetails, setGroupDetails] = useState<Group | null>(null);
  const [isSending, setIsSending] = useState(false);
  
  // Notification State
  const [unreadUserCount, setUnreadUserCount] = useState(0);
  const [hasAIUpdate, setHasAIUpdate] = useState(false);
  
  // Call State
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [visualizerData, setVisualizerData] = useState<number[]>(new Array(5).fill(10));
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);

  // WebRTC Refs
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callsRef = useRef<any[]>([]); // Track active PeerJS calls
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceNodesRef = useRef<MediaStreamAudioSourceNode[]>([]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userChatEndRef = useRef<HTMLDivElement>(null);

  // UI State
  const [mobileView, setMobileView] = useState<'chat' | 'canvas'>('chat');
  const [showOnlineUsers, setShowOnlineUsers] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Presence[]>([]);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  
  // Chat Mode: 'ai' | 'user' | 'both'
  const [chatMode, setChatMode] = useState<'ai' | 'user' | 'both'>('ai');

  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const [canvasState, setCanvasState] = useState<CanvasState>({ html: '', css: '', js: '', lastUpdated: 0, terminalOutput: [] });
  const [tokenUsage, setTokenUsage] = useState<any>({});
  
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
          // Auto-close call for local user if it ended remotely
          if (details && !details.isCallActive && isInCall) {
              leaveCall();
          }

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
          if (isInCall) leaveCall(); 
      };
  }, [groupId, currentUser]);

  // --- WebRTC Audio Logic (PeerJS) ---

  const startCall = async () => {
      if (!groupId) return;
      if (confirm("Do you want to execute the call?")) {
          // Initialize call state in Firestore
          await setGroupCallState(groupId, true, currentUser.uid);
          joinCall();
      }
  };

  const joinCall = async () => {
      if (!groupId) return;

      try {
          // 1. Get Local Stream
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = stream;
          setIsMuted(false);

          // 2. Initialize Peer
          const peer = new Peer(currentUser.uid); // Use UID as Peer ID
          peerRef.current = peer;

          peer.on('open', async (id) => {
              console.log('My peer ID is: ' + id);
              // 3. Register presence in call
              await joinCallSession(groupId, currentUser.uid);
              setIsInCall(true);
              
              // 4. Connect to existing participants
              // Note: We need the list of *other* participants.
              // We rely on GroupDetails update or we can fetch them.
              // For robustness, in Mesh, usually new joiner calls everyone.
              if (groupDetails?.callParticipants) {
                  groupDetails.callParticipants.forEach(pid => {
                      if (pid !== currentUser.uid) {
                          connectToPeer(pid, stream);
                      }
                  });
              }
          });

          // 5. Handle Incoming Calls
          peer.on('call', (call) => {
              console.log('Incoming call from:', call.peer);
              call.answer(stream); // Answer with our stream
              handleCallStream(call);
              callsRef.current.push(call);
          });
          
          // Setup Audio Context for Visualizer (Mixing Local + Remote)
          setupAudioMixing(stream);

      } catch (e) {
          console.error("Failed to join call", e);
          alert("Could not access microphone or connect to peer server.");
      }
  };

  const connectToPeer = (peerId: string, stream: MediaStream) => {
      if (!peerRef.current) return;
      console.log('Calling peer:', peerId);
      const call = peerRef.current.call(peerId, stream);
      if (call) {
        handleCallStream(call);
        callsRef.current.push(call);
      }
  };

  const handleCallStream = (call: any) => {
      call.on('stream', (remoteStream: MediaStream) => {
          console.log('Received remote stream');
          // Update state to render hidden audio element
          setRemoteStreams(prev => [...prev, remoteStream]);
          
          // Add to Audio Mixer for Visualizer
          addStreamToMixer(remoteStream);
      });
      call.on('close', () => {
           // Handle peer disconnect if needed
      });
  };

  const setupAudioMixing = (localStream: MediaStream) => {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      analyserRef.current = analyser;

      // Master Gain for visualizer input
      const masterGain = audioCtx.createGain();
      masterGain.connect(analyser);

      // Add Local Stream
      const localSource = audioCtx.createMediaStreamSource(localStream);
      localSource.connect(masterGain);
      sourceNodesRef.current.push(localSource);

      // Start Visualizer Loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVisualizer = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          
          const points = [dataArray[0], dataArray[2], dataArray[4], dataArray[6], dataArray[8]]
              .map(val => Math.max(10, val / 2.55)); // Normalize to % (0-100ish)

          setVisualizerData(points);
          animationFrameRef.current = requestAnimationFrame(updateVisualizer);
      };
      updateVisualizer();
  };

  const addStreamToMixer = (stream: MediaStream) => {
      if (!audioContextRef.current || !analyserRef.current) return;
      try {
        const source = audioContextRef.current.createMediaStreamSource(stream);
        // Connect to analyser for visualization (do NOT connect to destination to avoid echo/feedback loop, 
        // as the <audio> element handles playback)
        source.connect(analyserRef.current); 
        sourceNodesRef.current.push(source);
      } catch (e) {
          console.error("Error adding stream to mixer", e);
      }
  };

  const leaveCall = async () => {
      // 1. Cleanup Media
      if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
          localStreamRef.current = null;
      }
      
      // 2. Cleanup Audio Context
      if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
      }
      if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
      }
      sourceNodesRef.current = [];

      // 3. Close Peer Connections
      callsRef.current.forEach(call => call.close());
      callsRef.current = [];
      if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
      }
      
      setRemoteStreams([]);
      setIsInCall(false);
      setVisualizerData(new Array(5).fill(10));

      // 4. Update Firestore
      if (groupId) {
          await leaveCallSession(groupId, currentUser.uid);
      }
  };

  const handleEndForEveryone = async () => {
      if (confirm("Do you want to end the call for everyone?")) {
          if (groupId) {
              await endGroupCall(groupId);
          }
      }
  };

  const toggleMute = () => {
      if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach(track => {
              track.enabled = !track.enabled;
          });
          setIsMuted(!isMuted);
      }
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

  const extractCode = (text: string) => {
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
          let lastMessageUpdateTime = 0;
          let lastCanvasUpdateTime = 0;
          const MESSAGE_THROTTLE = 150; 
          const CANVAS_THROTTLE = 800;  

          await streamGeminiResponse(
              userMsg.text,
              validHistory,
              canvasState,
              async (chunk) => {
                  accumulatedText += chunk;
                  const codeUpdates = extractCode(accumulatedText);
                  
                  if (codeUpdates.html) {
                       setCanvasState(prev => ({ ...prev, html: codeUpdates.html!, lastUpdated: Date.now() }));
                       if (isCanvasCollapsed && setIsCanvasCollapsed) setIsCanvasCollapsed(false);

                       const now = Date.now();
                       if (now - lastCanvasUpdateTime > CANVAS_THROTTLE) {
                           lastCanvasUpdateTime = now;
                           await updateCanvas(groupId, { html: codeUpdates.html });
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

          const finalCode = extractCode(accumulatedText);
          if (finalCode.html) {
              await updateCanvas(groupId, { html: finalCode.html });
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

  const handleSend = async () => {
    if (!input.trim() || !groupId) return;
    
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
      } catch (e) {
          console.error("Error sending user chat", e);
      }
  };

  const handleUserChatDelete = async (msgId: string) => {
    if (confirm("Delete this message?")) {
        await deleteUserChatMessage(groupId!, msgId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, type: 'ai' | 'user' = 'ai') => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (type === 'ai') handleSend();
      else handleUserChatSend();
    }
  };

  const handleEdit = async (msg: Message) => {
      await setGroupLock(groupId!, currentUser.uid);
      setEditingMessageId(msg.id);
      setInput(msg.text);
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

  const renderAIChat = (isCompact: boolean) => (
      <div className="flex flex-col h-full relative">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center scroll-smooth relative">
            <div className="w-full space-y-6 pb-4">
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

                return (
                    <div 
                        key={msg.id} 
                        className={`group relative flex gap-3 ${isUserRole ? 'flex-row-reverse' : 'flex-row'} smooth-transition animate-[fadeIn_0.5s_ease-out]`}
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
                                    {msg.text}
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

        <div className={`bg-[#131314] border-t border-[#444746] z-30 ${isCompact ? 'p-1' : 'p-3'}`}>
            {editingMessageId && (
                <div className="text-xs text-[#A8C7FA] mb-1 flex justify-between">
                    <span>Editing...</span>
                    <button onClick={() => { setEditingMessageId(null); setInput(''); setGroupLock(groupId!, null); }} className="hover:underline">Cancel</button>
                </div>
            )}
            <div className={`bg-[#1E1F20] rounded-full flex items-center px-3 gap-2 border smooth-transition ${isCompact ? 'py-1' : 'py-2'} ${editingMessageId ? 'border-[#4285F4]' : 'border-transparent focus-within:border-[#444746]'}`}>
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, 'ai')}
                    placeholder={editingMessageId ? "Edit prompt..." : "Ask Gemini..."}
                    className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#C4C7C5]"
                />
                
                {isSystemBusy && !input.trim() ? (
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
                        disabled={!input.trim() && !editingMessageId}
                        className={`p-1.5 rounded-full smooth-transition transform ${
                            input.trim() || editingMessageId 
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
                              <div key={msg.id} className={`flex gap-3 animate-[fadeIn_0.3s_ease-out] group/msg ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
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
                  <div className="mb-2 bg-[#2A2B2D] border border-[#4285F4] rounded-lg p-2 flex items-center justify-between animate-[fadeIn_0.3s_ease-out]">
                      <div className="flex items-center gap-2 text-xs text-[#E3E3E3]">
                           <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                           <span>Join the call</span>
                      </div>
                      <button 
                          onClick={joinCall}
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
                    ref={audioEl => {
                        if (audioEl) audioEl.srcObject = stream;
                    }} 
                  />
              ))}

              <div className={`bg-[#2A2B2D] rounded-full flex items-center px-3 gap-2 border border-transparent focus-within:border-[#5E5E5E] smooth-transition ${isCompact ? 'py-1' : 'py-2'}`}>
                  {/* Call Button */}
                  <button 
                      onClick={startCall}
                      disabled={isInCall}
                      className={`p-1.5 rounded-full text-[#C4C7C5] hover:text-green-400 hover:bg-[#333537] smooth-transition ${isInCall ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title="Start Call"
                  >
                      <PhoneIcon className="w-5 h-5" />
                  </button>

                  <input 
                      type="text" 
                      value={userChatInput}
                      onChange={(e) => setUserChatInput(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, 'user')}
                      placeholder="Message the group..."
                      className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#5E5E5E]"
                  />
                  
                  {/* Persistent Send Icon */}
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
  );

  return (
    <div className="flex h-full bg-[#131314] overflow-hidden smooth-transition">
        
      {/* Left Panel */}
      <div className={`flex flex-col border-r border-[#444746] smooth-transition
            ${mobileView === 'canvas' ? 'hidden md:flex' : 'flex w-full'} 
            ${isCanvasCollapsed ? 'md:w-full max-w-4xl mx-auto md:border-r-0' : 'md:w-[35%] md:min-w-[350px]'}
      `}>
        
        {/* Top Bar */}
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-[#444746] bg-[#131314]">
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
                        <div className="absolute top-full right-0 mt-2 w-48 bg-[#1E1F20] border border-[#444746] rounded-lg shadow-xl z-50 overflow-hidden smooth-transition animate-[fadeIn_0.2s_ease-out]">
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
                        <div className="absolute top-full right-0 mt-2 w-64 bg-[#1E1F20] border border-[#444746] rounded-lg shadow-xl z-50 overflow-hidden smooth-transition animate-[fadeIn_0.2s_ease-out]">
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
        <div className="flex-1 flex flex-col min-h-0 relative">
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

      {/* Right Panel */}
      {!isCanvasCollapsed && (
          <div className={`flex-1 h-full flex flex-col min-w-0 smooth-transition
              ${mobileView === 'canvas' ? 'hidden md:flex' : 'flex w-full'}`
          }>
             <div className="h-8 bg-[#1E1F20] border-b border-[#444746] flex items-center justify-end px-2">
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
                    onCloseMobile={() => setMobileView('chat')}
                />
             </div>
          </div>
      )}

    </div>
  );
};

export default ChatInterface;