import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ImageUploadIcon, MicIcon, SparklesIcon } from './Icons';
import { Message } from '../types';
import { streamGeminiResponse } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

interface ChatInterfaceProps {
  currentUser: any;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  groupId?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ currentUser, messages, setMessages, groupId }) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      text: input,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || 'Guest',
      timestamp: Date.now(),
      role: 'user'
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsSending(true);

    const modelMsgId = (Date.now() + 1).toString();
    const initialModelMsg: Message = {
        id: modelMsgId,
        text: '',
        senderId: 'gemini',
        senderName: 'Gemini',
        timestamp: Date.now(),
        role: 'model',
        isLoading: true
    };
    
    setMessages(prev => [...prev, initialModelMsg]);

    const history = messages.map(m => ({
        role: m.role as 'user' | 'model',
        text: m.text
    }));

    await streamGeminiResponse(
        userMsg.text,
        history,
        (chunk) => {
            setMessages(prev => prev.map(msg => {
                if (msg.id === modelMsgId) {
                    return { ...msg, text: msg.text + chunk, isLoading: false };
                }
                return msg;
            }));
        }
    );

    setIsSending(false);
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
        <div className="flex items-center gap-2 cursor-pointer hover:bg-[#1E1F20] p-2 rounded-lg transition-colors">
          <span className="text-[#E3E3E3] font-medium text-lg">GemGroupChat</span>
          <span className="text-[#C4C7C5] text-sm hidden sm:inline-block">▼</span>
        </div>
        
        {groupId && (
           <div className="bg-[#1E1F20] px-3 py-1 rounded-full border border-[#444746]">
              <span className="text-xs text-green-400 flex items-center gap-2">
                 <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                 Group Session Active
              </span>
           </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center">
        {messages.length === 0 ? (
          <div className="flex flex-col items-start justify-center max-w-3xl w-full h-full space-y-8 mt-12 animate-[fadeIn_0.5s_ease-in-out]">
             <div className="space-y-2">
                <h1 className="text-5xl font-medium text-[#444746] tracking-tight">
                    <span className="gemini-gradient-text">Hello, {currentUser.displayName?.split(' ')[0] || 'Guest'}</span>
                </h1>
                <p className="text-2xl text-[#444746] font-medium">How can I help you today?</p>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 w-full mt-8">
                {[
                  { text: 'Brainstorm team bonding activities', icon: '💡' },
                  { text: 'Draft an email to a recruiter', icon: '✉️' },
                  { text: 'Plan a mental health day', icon: '🧘' },
                  { text: 'Python script for daily reports', icon: '🐍' }
                ].map((item, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => setInput(item.text)}
                      className="bg-[#1E1F20] hover:bg-[#28292A] p-4 rounded-xl text-left flex flex-col justify-between h-40 transition-all duration-200 border border-transparent hover:border-[#444746] group"
                    >
                        <span className="text-[#E3E3E3] text-sm group-hover:text-white">{item.text}</span>
                        <div className="bg-[#131314] w-8 h-8 rounded-full flex items-center justify-center self-end mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                           <span className="text-xs">{item.icon}</span>
                        </div>
                    </button>
                ))}
             </div>
          </div>
        ) : (
          <div className="w-full max-w-3xl space-y-6 pb-24">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${msg.role === 'user' ? 'bg-[#444746]' : 'bg-transparent'}`}>
                  {msg.role === 'user' ? (
                     <span className="text-xs text-white">{currentUser.isAnonymous ? 'G' : currentUser.displayName?.[0]}</span>
                  ) : (
                     <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg" alt="AI" className="w-6 h-6 animate-[spin_10s_linear_infinite]" />
                  )}
                </div>
                
                <div className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className="text-sm text-[#C4C7C5] mb-1 px-1">
                    {msg.role === 'user' ? 'You' : 'Gemini'}
                  </div>
                  <div className={`prose prose-invert prose-sm md:prose-base text-[#E3E3E3] leading-relaxed ${msg.isLoading ? 'animate-pulse' : ''}`}>
                    {msg.isLoading && msg.text === '' ? (
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
            ))}
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
              placeholder="Enter a prompt here"
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
