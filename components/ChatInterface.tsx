import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ImageUploadIcon, MicIcon } from './Icons';
import { Message } from '../types';
import { streamGeminiResponse } from '../services/geminiService';
import { subscribeToMessages, sendMessage, updateMessage, getGroupDetails } from '../services/firebase';
import ReactMarkdown from 'react-markdown';

interface ChatInterfaceProps {
  currentUser: any;
  messages: Message[]; 
  setMessages: any;    
  groupId?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ currentUser, groupId }) => {
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [groupName, setGroupName] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [localMessages]);

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
        // We construct history with Explicit Name Prefixes to context
        const history = localMessages.map(m => {
            let content = m.text;
            // Prepend name to user messages in history for context
            if (m.role === 'user') {
                content = `[${m.senderName}]: ${m.text}`;
            }
            return {
                role: m.role as 'user' | 'model',
                text: content
            };
        });

        // Add the current message with name prefix
        const currentPrompt = `[${senderDisplayName}]: ${userMsg.text}`;

        let accumulatedText = '';
        await streamGeminiResponse(
            currentPrompt,
            history,
            async (chunk) => {
                accumulatedText += chunk;
                await updateMessage(groupId, modelMsgId, { 
                    text: accumulatedText,
                    isLoading: true 
                });
            }
        );

        // Finalize
        await updateMessage(groupId, modelMsgId, { 
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
      <div className="h-16 flex items-center justify-between px-6 border-b border-[#444746] bg-[#131314] sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-[#E3E3E3] font-medium text-lg">{groupName || 'Group Chat'}</span>
          <span className="text-[#C4C7C5] text-sm hidden sm:inline-block">▼</span>
        </div>
        
        {groupId && (
           <div className="bg-[#1E1F20] px-3 py-1 rounded-full border border-[#444746] flex items-center gap-2">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              <span className="text-xs text-[#E3E3E3]">Live Session</span>
           </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center scroll-smooth">
        {localMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#C4C7C5] opacity-50">
             <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <div className="w-full max-w-3xl space-y-6 pb-24">
            {localMessages.map((msg) => {
              const isMe = msg.senderId === currentUser.uid;
              const isGemini = msg.role === 'model';
              
              return (
                <div key={msg.id} className={`flex gap-4 ${isMe && !isGemini ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center overflow-hidden border border-[#444746] ${isGemini ? 'bg-transparent' : 'bg-[#1E1F20]'}`}>
                    {isGemini ? (
                       <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="AI" className="w-6 h-6 animate-[spin_10s_linear_infinite]" />
                    ) : (
                       <span className="text-xs text-white font-bold">{msg.senderName?.[0] || 'U'}</span>
                    )}
                  </div>
                  
                  {/* Message Content */}
                  <div className={`flex flex-col max-w-[85%] ${isMe && !isGemini ? 'items-end' : 'items-start'}`}>
                    {/* Name Label - Requested Feature */}
                    <div className="text-xs text-[#C4C7C5] mb-1 px-1 flex gap-2">
                      <span className="font-medium text-[#E3E3E3]">{msg.senderName}</span>
                      <span className="opacity-50">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    
                    <div className={`prose prose-invert prose-sm md:prose-base text-[#E3E3E3] leading-relaxed break-words max-w-full ${msg.isLoading ? 'animate-pulse' : ''}`}>
                      {msg.isLoading && !msg.text ? (
                          <div className="flex gap-1 mt-2">
                             <div className="w-2 h-2 bg-[#E3E3E3] rounded-full animate-bounce"></div>
                             <div className="w-2 h-2 bg-[#E3E3E3] rounded-full animate-bounce delay-100"></div>
                             <div className="w-2 h-2 bg-[#E3E3E3] rounded-full animate-bounce delay-200"></div>
                          </div>
                      ) : (
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
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
         <div className="w-full max-w-3xl bg-[#1E1F20] rounded-full flex items-center px-4 py-3 gap-3 border border-transparent focus-within:border-[#444746] transition-colors shadow-lg">
            <button className="p-2 hover:bg-[#333537] rounded-full text-[#E3E3E3] transition-colors">
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
            <button className="p-2 hover:bg-[#333537] rounded-full text-[#E3E3E3] transition-colors">
               <MicIcon />
            </button>
            {input.trim() && (
                <button 
                  onClick={handleSend}
                  className="p-2 bg-[#D3E3FD] hover:bg-white text-black rounded-full transition-colors animate-[fadeIn_0.2s_ease-out]"
                >
                    <SendIcon />
                </button>
            )}
         </div>
      </div>
      <div className="text-center pb-2 text-[10px] text-[#C4C7C5] bg-[#131314]">
         Gemini may display inaccurate info, including about people, so double-check its responses.
      </div>
    </div>
  );
};

export default ChatInterface;