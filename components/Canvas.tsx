import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CanvasState } from '../types';
import { updateCanvas } from '../services/firebase';

interface CanvasProps {
  canvasState: CanvasState;
  groupId: string;
}

const Canvas: React.FC<CanvasProps> = ({ canvasState, groupId }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'terminal'>('preview');
  
  // Refs for scroll sync
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlighterRef = useRef<HTMLDivElement>(null);

  // Auto-compile handled by the AI's single file output now.
  // We just use canvasState.html directly as it contains style/script.

  const handleCodeChange = (code: string) => {
      // Update only HTML field as we are in single-file mode
      updateCanvas(groupId, { html: code });
  };

  // Scroll Sync Handler
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
      if (highlighterRef.current) {
          highlighterRef.current.scrollTop = e.currentTarget.scrollTop;
          highlighterRef.current.scrollLeft = e.currentTarget.scrollLeft;
      }
  };

  // Shared styles to ensure perfect alignment
  const editorStyle = {
      fontFamily: '"Fira Code", "Consolas", "Monaco", "Andale Mono", "Ubuntu Mono", monospace',
      fontSize: '14px',
      lineHeight: '1.5',
      padding: '1rem',
  };

  return (
    <div className="flex flex-col h-full bg-[#1E1F20] border-l border-[#444746]">
      {/* Tabs */}
      <div className="flex items-center justify-between px-4 pt-2 border-b border-[#444746] bg-[#1E1F20]">
        <div className="flex">
            <button
            onClick={() => setActiveTab('preview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'preview'
                ? 'border-[#4285F4] text-[#4285F4]'
                : 'border-transparent text-[#C4C7C5] hover:text-[#E3E3E3]'
            }`}
            >
            Preview
            </button>
            <button
            onClick={() => setActiveTab('code')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'code'
                ? 'border-[#4285F4] text-[#4285F4]'
                : 'border-transparent text-[#C4C7C5] hover:text-[#E3E3E3]'
            }`}
            >
            Code
            </button>
            <button
            onClick={() => setActiveTab('terminal')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'terminal'
                ? 'border-[#4285F4] text-[#4285F4]'
                : 'border-transparent text-[#C4C7C5] hover:text-[#E3E3E3]'
            }`}
            >
            Terminal
            </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative">
        
        {/* Preview Mode */}
        <div className={`absolute inset-0 w-full h-full bg-white transition-opacity duration-300 ${activeTab === 'preview' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
            {canvasState.html ? (
                <iframe 
                    srcDoc={canvasState.html}
                    title="preview"
                    className="w-full h-full border-none"
                    sandbox="allow-scripts allow-modals"
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    No code to preview yet. Ask Gemini to create something!
                </div>
            )}
        </div>

        {/* Code Mode - Editable (Single File) */}
        <div className={`absolute inset-0 w-full h-full bg-[#1E1F20] flex flex-col transition-opacity duration-300 ${activeTab === 'code' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
             
             {/* File Header */}
             <div className="flex bg-[#131314] border-b border-[#444746] px-4 py-1">
                 <span className="text-xs font-mono text-[#A8C7FA]">index.html (Single File Component)</span>
             </div>

             {/* Editor Area */}
             <div className="relative flex-1 overflow-hidden">
                 {/* Syntax Highlighter (Background) */}
                 <div 
                    ref={highlighterRef}
                    className="absolute inset-0 pointer-events-none overflow-hidden" 
                    style={{ zIndex: 0 }}
                 >
                    <SyntaxHighlighter
                        language="html"
                        style={vscDarkPlus}
                        showLineNumbers={true}
                        wrapLines={false} 
                        customStyle={{ 
                            ...editorStyle,
                            margin: 0, 
                            minHeight: '100%', 
                            background: '#131314',
                            overflow: 'hidden' 
                        }}
                        codeTagProps={{ style: { fontFamily: editorStyle.fontFamily } }}
                    >
                        {canvasState.html || ' '}
                    </SyntaxHighlighter>
                 </div>

                 {/* Editable Textarea (Foreground) */}
                 <textarea
                    ref={textareaRef}
                    value={canvasState.html || ''}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    onScroll={handleScroll}
                    spellCheck="false"
                    className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-white resize-none outline-none whitespace-pre"
                    style={{ 
                        ...editorStyle,
                        zIndex: 1, 
                        overflow: 'auto', 
                    }}
                 />
             </div>
        </div>

        {/* Terminal Mode */}
        <div className={`absolute inset-0 w-full h-full bg-[#131314] font-mono text-sm overflow-auto transition-opacity duration-300 ${activeTab === 'terminal' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
            <div className="p-4 space-y-1">
                <div className="text-green-400">$ system init</div>
                <div className="text-[#C4C7C5]">Gemini Canvas Environment Ready...</div>
                {canvasState.terminalOutput?.map((line, i) => (
                    <div key={i} className="text-[#E3E3E3] border-l-2 border-[#444746] pl-2 my-1">
                        {line}
                    </div>
                ))}
                <div className="text-green-400 animate-pulse">_</div>
            </div>
        </div>

      </div>
    </div>
  );
};

export default Canvas;