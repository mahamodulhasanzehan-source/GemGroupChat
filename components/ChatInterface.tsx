import React, { useState, useRef, useEffect } from 'react';
import { SendIcon, ImageUploadIcon, MicIcon } from './Icons';
import { Message, CanvasState } from '../types';
import { streamGeminiResponse } from '../services/geminiService';
import { subscribeToMessages, sendMessage, updateMessage, getGroupDetails, subscribeToTokenUsage, subscribeToCanvas, updateCanvas } from '../services/firebase';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Canvas from './Canvas';

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

  // Canvas State
  const [canvasState, setCanvasState] = useState<CanvasState>({ html: '', css: '', js: '', lastUpdated: 0, terminalOutput: [] });

  // Token Usage State
  const [tokenUsage, setTokenUsage] = useState<any>({});
  const TOKEN_LIMIT = 1000000; // 1M TPM Limit

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

  // Subscribe to Canvas State
  useEffect(() => {
      if (!groupId) return;
      const unsubscribe = subscribeToCanvas(groupId, (data) => {
          if (data) setCanvasState(data);
      });
      return () => unsubscribe;
  }, [groupId]);

  // Extract Code Blocks helper
  const extractCode = (text: string) => {
      const htmlMatch = text.match(/```html\n([\s\S]*?)```/);
      const cssMatch = text.match(/```css\n([\s\S]*?)```/);
      const jsMatch = text.match(/```javascript\n([\s\S]*?)```/) || text.match(/```js\n([\s\S]*?)```/);
      
      return {
          html: htmlMatch ? htmlMatch[1] : null,
          css: cssMatch ? cssMatch[1] : null,
          js: jsMatch ? jsMatch[1] : null,
      };
  };

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
        await sendMessage(groupId, userMsg);
        setInput('');

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

        await sendMessage(groupId, initialModelMsg);

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
        const UPDATE_THROTTLE = 300; 

        await streamGeminiResponse(
            currentPrompt,
            history,
            canvasState, // Pass current canvas state context
            async (chunk) => {
                accumulatedText += chunk;
                
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

        // Parse final response for code updates
        const codeUpdates = extractCode(accumulatedText);
        let canvasUpdated = false;
        const newCanvas = { ...canvasState };
        const logs = [...(newCanvas.terminalOutput || [])];

        if (codeUpdates.html) {
            newCanvas.html = codeUpdates.html;
            logs.push(`> Updated HTML (${codeUpdates.html.length} chars)`);
            canvasUpdated = true;
        }
        if (codeUpdates.css) {
            newCanvas.css = codeUpdates.css;
            logs.push(`> Updated CSS (${codeUpdates.css.length} chars)`);
            canvasUpdated = true;
        }
        if (codeUpdates.js) {
            newCanvas.js = codeUpdates.js;
            logs.push(`> Updated JS (${codeUpdates.js.length} chars)`);
            canvasUpdated = true;
        }

        if (canvasUpdated) {
            newCanvas.terminalOutput = logs.slice(-20); // Keep last 20 logs
            await updateCanvas(groupId, newCanvas);
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

  // Calculate current key usage stats
  const activeIndex = tokenUsage.activeKeyIndex || 0;
  const currentKeyUsage = tokenUsage[`key_${activeIndex}`] || 0;

  return (
    <div className="flex h-full bg-[#131314] overflow-hidden">
        
      {/* Left Panel: Chat (35%) */}
      <div className="w-[35%] flex flex-col border-r border-[#444746] min-w-[350px]">
        
        {/* Top Bar */}
        <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-[#444746] bg-[#131314]">
            <span className="text-[#E3E3E3] font-medium tracking-tight truncate">{groupName || 'Chat'}</span>
            
            {/* New Token Usage Rectangle */}
            <div className="flex items-center gap-0 text-xs font-mono bg-[#1E1F20] border border-[#444746] rounded overflow-hidden shadow-sm">
                <div className="bg-[#333537] text-[#A8C7FA] px-2 py-1 border-r border-[#444746]">
                    Key {activeIndex + 1}
                </div>
                <div className="text-[#C4C7C5] px-2 py-1">
                    {formatTokenCount(currentKeyUsage)} / 1M
                </div>
            </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center scroll-smooth">
            {localMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#C4C7C5] opacity-50 mt-10">
                <p className="text-sm font-light">Ask Gemini to write some code!</p>
            </div>
            ) : (
            <div className="w-full space-y-6 pb-4">
                {localMessages.map((msg) => {
                const isMe = msg.senderId === currentUser.uid;
                const isGemini = msg.role === 'model';
                
                return (
                    <div key={msg.id} className={`flex gap-3 ${isMe && !isGemini ? 'flex-row-reverse' : 'flex-row'}`}>
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
                                    // If it's a code block, we render a simplified view in chat because it's in the canvas
                                    if (match) {
                                        return (
                                            <div className="my-1 p-2 bg-[#131314] border border-[#444746] rounded text-xs text-[#A8C7FA] font-mono flex items-center gap-2">
                                                <span>📄 Updated {match[1]} content in Canvas</span>
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
                    </div>
                );
                })}
                <div ref={messagesEndRef} />
            </div>
            )}
        </div>

        {/* Input */}
        <div className="p-3 bg-[#131314] border-t border-[#444746]">
            <div className="bg-[#1E1F20] rounded-full flex items-center px-3 py-2 gap-2 border border-transparent focus-within:border-[#444746] transition-all">
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type instructions..."
                    className="flex-1 bg-transparent border-none outline-none text-[#E3E3E3] text-sm placeholder-[#C4C7C5]"
                    disabled={isSending}
                />
                {input.trim() && (
                    <button onClick={handleSend} className="p-1.5 bg-[#A8C7FA] text-[#000] rounded-full hover:scale-105 transition-transform">
                        <SendIcon />
                    </button>
                )}
            </div>
        </div>
      </div>

      {/* Right Panel: Canvas (65%) */}
      <div className="flex-1 h-full">
         <Canvas canvasState={canvasState} />
      </div>

    </div>
  );
};

export default ChatInterface;
