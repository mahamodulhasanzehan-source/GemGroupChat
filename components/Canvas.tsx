import React, { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CanvasState } from '../types';

interface CanvasProps {
  canvasState: CanvasState;
}

const Canvas: React.FC<CanvasProps> = ({ canvasState }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'terminal'>('preview');
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

  return (
    <div className="flex flex-col h-full bg-[#1E1F20] border-l border-[#444746]">
      {/* Tabs */}
      <div className="flex items-center px-4 pt-2 border-b border-[#444746] bg-[#1E1F20]">
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

        {/* Code Mode */}
        <div className={`absolute inset-0 w-full h-full bg-[#1E1F20] overflow-auto transition-opacity duration-300 ${activeTab === 'code' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
             <div className="flex flex-col gap-4 p-4">
                 
                 {/* HTML Block */}
                 {canvasState.html && (
                     <div className="rounded-lg border border-[#444746] overflow-hidden">
                         <div className="bg-[#2D2E30] px-3 py-1 text-xs text-[#A8C7FA] font-mono border-b border-[#444746]">index.html</div>
                         <SyntaxHighlighter
                            language="html"
                            style={vscDarkPlus}
                            showLineNumbers={true}
                            customStyle={{ margin: 0, fontSize: '13px', background: '#131314' }}
                         >
                            {canvasState.html}
                         </SyntaxHighlighter>
                     </div>
                 )}

                 {/* CSS Block */}
                 {canvasState.css && (
                     <div className="rounded-lg border border-[#444746] overflow-hidden">
                         <div className="bg-[#2D2E30] px-3 py-1 text-xs text-[#ce9178] font-mono border-b border-[#444746]">styles.css</div>
                         <SyntaxHighlighter
                            language="css"
                            style={vscDarkPlus}
                            showLineNumbers={true}
                            customStyle={{ margin: 0, fontSize: '13px', background: '#131314' }}
                         >
                            {canvasState.css}
                         </SyntaxHighlighter>
                     </div>
                 )}

                 {/* JS Block */}
                 {canvasState.js && (
                     <div className="rounded-lg border border-[#444746] overflow-hidden">
                         <div className="bg-[#2D2E30] px-3 py-1 text-xs text-[#dcdcaa] font-mono border-b border-[#444746]">script.js</div>
                         <SyntaxHighlighter
                            language="javascript"
                            style={vscDarkPlus}
                            showLineNumbers={true}
                            customStyle={{ margin: 0, fontSize: '13px', background: '#131314' }}
                         >
                            {canvasState.js}
                         </SyntaxHighlighter>
                     </div>
                 )}
                 
                 {!canvasState.html && !canvasState.css && !canvasState.js && (
                     <div className="text-[#C4C7C5] text-center mt-10">Canvas is empty.</div>
                 )}
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
