import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ImageUploadIcon, MicIcon } from './Icons';
import { Message } from '../types';
import { streamGeminiResponse } from '../services/geminiService';
import { subscribeToMessages, sendMessage, updateMessage, getGroupDetails, subscribeToTokenUsage } from '../services/firebase';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface ChatInterfaceProps {
  currentUser: any;
  messages: Message[]; 
  setMessages: any;    
  groupId?: string;
}

// Helper for token display
const formatTokenCount = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ currentUser, groupId }) => {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [groupName, setGroupName] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Token Usage State
  const [tokenUsage, setTokenUsage] = useState<Record<string, number>>({});
  const TOKEN_LIMIT = 1000000; // 1M TPM Limit per key (example)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [localMessages]);

  // Subscribe to Token Usage
  useEffect(() => {
      const unsubscribe = subscribeToTokenUsage((data) => {
          setTokenUsage(data);
      });
      return () => unsubscribe();
  }, []);

  // Subscribe to Group Messages
  useEffect(() => {
      if (!groupId) return;

      getGroupDetails(groupId).then(details => {
          if (details) setGroupName(details.name);
      });

      const unsubscribe = subscribeToMessages(groupId, (msgs) => {
          setLocalMessages(msgs);
      });
      return () => unsubscribe();
  }, [groupId]);

  const handleSend = async () => {
    if (!input.trim() || isSending || !groupId) return;
    setIsSending(true);

    const senderDisplayName = currentUser.displayName || 'Guest';

    const userMsgId = Date.now().toString();
    const userMsg: Message = {
      id: userMsgId,
      text: input,
      senderId: currentUser.uid,
      senderName: senderDisplayName,
      timestamp: Date.now(),
      role: 'user'
    };

    try {
        // 1. Send User Message to DB (Syncs to everyone)
        await sendMessage(groupId, userMsg);
        setInput('');

        // 2. Prepare for AI Response
        const modelMsgId = (Date.now() + 1).toString();
        const initialModelMsg: Message = {
            id: modelMsgId,
            text: '',
            senderId: 'gemini',
            senderName: 'Gemini',
            timestamp: Date.now() + 1,
            role: 'model',
            isLoading: true
        };

        // 3. Create Placeholder for AI in DB
        await sendMessage(groupId, initialModelMsg);

        // 4. Generate AI Response
        const history = localMessages.map(m => {
            let content = m.text;
            if (m.role === 'user') {
                content = `[${m.senderName}]: ${m.text}`;
            }
            return {
                role: m.role as 'user' | 'model',
                text: content
            };
        });

        const currentPrompt = `[${senderDisplayName}]: ${userMsg.text}`;

        let accumulatedText = '';
        let lastUpdateTime = 0;
        // Optimization: Throttle updates to 300ms to reduce write frequency
        const UPDATE_THROTTLE = 300; 

        await streamGeminiResponse(
            currentPrompt,
            history,
            async (chunk) => {
                accumulatedText += chunk;
                
                const now = Date.now();
                if (now - lastUpdateTime > UPDATE_THROTTLE) {
                    lastUpdateTime = now;
                    // We optimistically update UI via subscription, but here we push to DB
                    await updateMessage(groupId, modelMsgId, { 
                        text: accumulatedText,
                        isLoading: true 
                    });
                }
            }
        );

        // Final update ensures complete text is saved
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#131314] relative overflow-hidden">
      {/* Top Bar */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-[#444746] bg-[#131314] sticky top-0 z-10 shadow-sm transition-all duration-300">
        <div className="flex items-center gap-2">
          <span className="text-[#E3E3E3] font-medium text-lg tracking-tight animate-[fadeIn_0.5s_ease-out]">{groupName || 'Group Chat'}</span>
          <span className="text-[#C4C7C5] text-sm hidden sm:inline-block cursor-pointer hover:text-white transition-colors">▼</span>
        </div>
        
        {/* Token Usage Bars */}
        <div className="flex items-center gap-3 animate-[fadeIn_0.5s_ease-out]">
            <span className="text-[10px] text-[#C4C7C5] uppercase tracking-wider hidden sm:block">Token Usage</span>
            <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((keyNum, i) => {
                    const usage = tokenUsage[`key_${i}`] || 0;
                    const percent = Math.min((usage / TOKEN_LIMIT) * 100, 100);
                    const isHigh = percent > 80;
                    
                    return (
                        <div key={i} className="group relative flex flex-col items-center justify-end w-2 h-6 bg-[#333537] rounded-sm overflow-hidden cursor-help">
                            {/* Bar Fill */}
                            <div 
                                className={`w-full transition-all duration-500 ${isHigh ? 'bg-red-400' : 'bg-green-400'}`}
                                style={{ height: `${percent}%` }}
                            ></div>
                            
                            {/* Tooltip */}
                            <div className="absolute top-full mt-2 right-0 hidden group-hover:block z-50 min-w-[120px] bg-[#1E1F20] border border-[#444746] rounded-md p-2 shadow-xl">
                                <p className="text-xs text-[#E3E3E3] font-bold mb-1">Key {keyNum}</p>
                                <p className="text-[10px] text-[#C4C7C5]">Used: {formatTokenCount(usage)}</p>
                                <p className="text-[10px] text-[#C4C7C5]">Limit: {formatTokenCount(TOKEN_LIMIT)}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center scroll-smooth">
        {localMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#C4C7C5] opacity-50 animate-[fadeIn_0.8s_ease-out]">
             <p className="text-lg font-light">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <div className="w-full max-w-3xl space-y-6 pb-24">
            {localMessages.map((msg) => {
              const isMe = msg.senderId === currentUser.uid;
              const isGemini = msg.role === 'model';
              
              return (
                <div key={msg.id} className={`flex gap-4 ${isMe && !isGemini ? 'flex-row-reverse' : 'flex-row'} animate-[fadeIn_0.3s_ease-out]`}>
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center overflow-hidden border border-[#444746] shadow-md transition-transform hover:scale-105 ${isGemini ? 'bg-transparent' : 'bg-[#1E1F20]'}`}>
                    {isGemini ? (
                       <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="AI" className="w-6 h-6 animate-[spin_10s_linear_infinite]" />
                    ) : (
                       <span className="text-xs text-white font-bold select-none">{msg.senderName?.[0]?.toUpperCase() || 'U'}</span>
                    )}
                  </div>
                  
                  {/* Message Content */}
                  <div className={`flex flex-col max-w-[85%] ${isMe && !isGemini ? 'items-end' : 'items-start'}`}>
                    <div className="text-xs text-[#C4C7C5] mb-1 px-1 flex gap-2 select-none">
                      <span className="font-medium text-[#E3E3E3]">{msg.senderName}</span>
                      <span className="opacity-50">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    
                    <div className={`prose prose-invert prose-sm md:prose-base text-[#E3E3E3] leading-relaxed break-words max-w-full rounded-2xl p-3 shadow-sm ${isMe && !isGemini ? 'bg-[#1E1F20] rounded-tr-none' : 'bg-transparent pl-0'} ${msg.isLoading ? 'animate-pulse' : ''} transition-all duration-200`}>
                      {msg.isLoading && !msg.text ? (
                          <div className="flex gap-1 mt-2 p-2">
                             <div className="w-2 h-2 bg-[#E3E3E3] rounded-full animate-bounce"></div>
                             <div className="w-2 h-2 bg-[#E3E3E3] rounded-full animate-bounce delay-100"></div>
                             <div className="w-2 h-2 bg-[#E3E3E3] rounded-full animate-bounce delay-200"></div>
                          </div>
                      ) : (
                          <ReactMarkdown
                            components={{
                              code(props) {
                                const {children, className, node, ...rest} = props
                                const match = /language-(\w+)/.exec(className || '')
                                if (match) {
                                    // FIX: Extract ref to avoid type mismatch with SyntaxHighlighter
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    const { ref, ...restNoRef } = rest as any;
                                    return (
                                        <div className="relative group/code my-2 rounded-lg overflow-hidden border border-[#444746]">
                                            <div className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={() => navigator.clipboard.writeText(String(children))}
                                                    className="bg-[#333537] text-xs text-white px-2 py-1 rounded hover:bg-[#444746]"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                            <SyntaxHighlighter
                                                {...restNoRef}
                                                PreTag="div"
                                                children={String(children).replace(/\n$/, '')}
                                                language={match[1]}
                                                style={vscDarkPlus}
                                                customStyle={{ margin: 0, padding: '1rem', fontSize: '0.9em' }}
                                            />
                                        </div>
                                    );
                                }
                                return (
                                  <code {...rest} className={`${className} bg-[#333537] px-1 py-0.5 rounded text-sm`}>
                                    {children}
                                  </code>
                                )
                              }
                            }}
                          >
                            {msg.text}
                          </ReactMarkdown>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="bg-[#131314] p-4 flex justify-center sticky bottom-0 z-20">
         <div className="w-full max-w-3xl bg-[#1E1F20] rounded-full flex items-center px-4 py-3 gap-3 border border-transparent focus-within:border-[#444746] transition-all duration-200 shadow-lg hover:shadow-xl hover:bg-[#28292a]">
            <button className="p-2 hover:bg-[#333537] rounded-full text-[#E3E3E3] transition-colors transform active:scale-95">
                <ImageUploadIcon />
            </button>
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message as ${currentUser.displayName || 'Guest'}...`}
              className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] placeholder-[#C4C7C5] text-base"
              disabled={isSending}
            />
            <button className="p-2 hover:bg-[#333537] rounded-full text-[#E3E3E3] transition-colors transform active:scale-95">
               <MicIcon />
            </button>
            {input.trim() && (
                <button 
                  onClick={handleSend}
                  className="p-2 bg-[#D3E3FD] hover:bg-white text-black rounded-full transition-all duration-200 animate-[zoomIn_0.2s_ease-out] hover:scale-110 active:scale-95 shadow-md"
                >
                    <SendIcon />
                </button>
            )}
         </div>
      </div>
      <div className="text-center pb-2 text-[10px] text-[#C4C7C5] bg-[#131314] select-none">
         Gemini may display inaccurate info, including about people, so double-check its responses.
      </div>
    </div>
  );
};

export default ChatInterface;