import React, { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CanvasState } from '../types';
import { updateCanvas } from '../services/firebase';

interface CanvasProps {
  canvasState: CanvasState;
  groupId: string; // Needed for updates
}

const Canvas: React.FC<CanvasProps> = ({ canvasState, groupId }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'terminal'>('preview');
  const [codeTab, setCodeTab] = useState<'html' | 'css' | 'js'>('html');
  const [compiledSrc, setCompiledSrc] = useState('');

  // Auto-compile when code changes
  useEffect(() => {
    const html = canvasState.html || '';
    const css = canvasState.css ? `<style>${canvasState.css}</style>` : '';
    const js = canvasState.js ? `<script>${canvasState.js}</script>` : '';
    
    // Inject scripts to handle errors in preview
    const errorHandling = `
      <script>
        window.onerror = function(message, source, lineno, colno, error) {
          window.parent.postMessage({type: 'console', log: 'Error: ' + message}, '*');
        };
        console.log = function(...args) {
          window.parent.postMessage({type: 'console', log: args.join(' ')}, '*');
        };
      </script>
    `;

    const src = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          ${css}
          ${errorHandling}
        </head>
        <body>
          ${html}
          ${js}
        </body>
      </html>
    `;
    setCompiledSrc(src);
  }, [canvasState]);

  const handleCodeChange = (code: string) => {
      // Create updates based on active code tab
      const updates: any = {};
      if (codeTab === 'html') updates.html = code;
      if (codeTab === 'css') updates.css = code;
      if (codeTab === 'js') updates.js = code;
      
      // Push update to DB (Debouncing handled by React state usually, but for firestore we want immediate local feel)
      // For a production app, debounce this. Here we assume direct sync.
      updateCanvas(groupId, updates);
  };

  const currentCode = canvasState[codeTab] || '';

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
            {compiledSrc && (
                <iframe 
                    srcDoc={compiledSrc}
                    title="preview"
                    className="w-full h-full border-none"
                    sandbox="allow-scripts"
                />
            )}
            {(!canvasState.html && !canvasState.js) && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                    No code to preview yet. Ask Gemini to create something!
                </div>
            )}
        </div>

        {/* Code Mode - Editable */}
        <div className={`absolute inset-0 w-full h-full bg-[#1E1F20] flex flex-col transition-opacity duration-300 ${activeTab === 'code' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
             
             {/* Language Tabs */}
             <div className="flex bg-[#131314] border-b border-[#444746]">
                 <button onClick={() => setCodeTab('html')} className={`px-4 py-1 text-xs font-mono border-r border-[#444746] ${codeTab === 'html' ? 'bg-[#2D2E30] text-[#A8C7FA]' : 'text-[#C4C7C5]'}`}>index.html</button>
                 <button onClick={() => setCodeTab('css')} className={`px-4 py-1 text-xs font-mono border-r border-[#444746] ${codeTab === 'css' ? 'bg-[#2D2E30] text-[#ce9178]' : 'text-[#C4C7C5]'}`}>styles.css</button>
                 <button onClick={() => setCodeTab('js')} className={`px-4 py-1 text-xs font-mono border-r border-[#444746] ${codeTab === 'js' ? 'bg-[#2D2E30] text-[#dcdcaa]' : 'text-[#C4C7C5]'}`}>script.js</button>
             </div>

             {/* Editor Area */}
             <div className="relative flex-1 overflow-hidden">
                 {/* Syntax Highlighter (Background) */}
                 <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
                    <SyntaxHighlighter
                        language={codeTab === 'js' ? 'javascript' : codeTab}
                        style={vscDarkPlus}
                        showLineNumbers={true}
                        customStyle={{ 
                            margin: 0, 
                            height: '100%', 
                            background: '#131314', 
                            fontSize: '14px', 
                            lineHeight: '1.5',
                            padding: '1rem',
                        }}
                        codeTagProps={{ style: { fontFamily: 'monospace' } }}
                    >
                        {currentCode || ' '}
                    </SyntaxHighlighter>
                 </div>

                 {/* Editable Textarea (Foreground) */}
                 <textarea
                    value={currentCode}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    spellCheck="false"
                    className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-white resize-none outline-none p-4 font-mono text-sm leading-[1.5]"
                    style={{ 
                        zIndex: 1, 
                        fontFamily: 'monospace', // Ensure alignment with syntax highlighter
                        fontSize: '14px'
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