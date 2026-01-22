import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CanvasState } from '../types';
import { updateCanvas } from '../services/firebase';
import { ChevronDownIcon, DownloadIcon } from './Icons';

interface CanvasProps {
  canvasState: CanvasState;
  groupId: string;
  onCloseMobile?: () => void; // Prop to handle back navigation on mobile
}

const ReloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
);

const Canvas: React.FC<CanvasProps> = ({ canvasState, groupId, onCloseMobile }) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'terminal'>('preview');
  const [reloadKey, setReloadKey] = useState(0); // State to force iframe reload
  
  // Refs for scroll sync
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlighterRef = useRef<HTMLDivElement>(null);

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

  const handleReload = () => {
      setReloadKey(prev => prev + 1);
  };

  const handleExtract = async () => {
      if (!canvasState.html) return;
      
      try {
          // Check for File System Access API support (Chrome/Edge/Desktop)
          // @ts-ignore
          if (window.showSaveFilePicker) {
              // @ts-ignore
              const handle = await window.showSaveFilePicker({
                  suggestedName: 'index.html',
                  types: [{
                      description: 'HTML File',
                      accept: {'text/html': ['.html']},
                  }],
              });
              const writable = await handle.createWritable();
              await writable.write(canvasState.html);
              await writable.close();
          } else {
              // Fallback for browsers that don't support the API (Firefox/Mobile)
              const blob = new Blob([canvasState.html], { type: 'text/html' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'index.html';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
          }
      } catch (err: any) {
          if (err.name !== 'AbortError') {
             console.error("Extract failed:", err);
             alert("Failed to save file. Please try again.");
          }
      }
  };

  // Shared styles to ensure perfect alignment
  const editorStyle = {
      fontFamily: '"Fira Code", "Consolas", "Monaco", "Andale Mono", "Ubuntu Mono", monospace',
      fontSize: '14px',
      lineHeight: '1.5',
      padding: '1rem',
  };

  // Inject a default style block to ensure the iframe background is dark immediately
  // preventing the white flash before the user's code loads.
  const getRenderedHtml = () => {
      const darkStyle = `<style>body { background-color: #131314 !important; color: #E3E3E3; }</style>`;
      if (!canvasState.html) return '';
      // Prepend to head if possible, otherwise just prepend to string
      return darkStyle + canvasState.html;
  };

  return (
    <div className="flex flex-col h-full bg-[#1E1F20] border-l border-[#444746] w-full smooth-transition">
      {/* Tabs */}
      <div className="flex items-center justify-between px-4 pt-2 border-b border-[#444746] bg-[#1E1F20] shrink-0">
        <div className="flex items-center gap-2">
            {/* Mobile Back Button */}
            {onCloseMobile && (
                <button 
                    onClick={onCloseMobile}
                    className="md:hidden p-1 mr-1 text-[#C4C7C5] hover:text-white"
                >
                    <ChevronDownIcon className="rotate-90" />
                </button>
            )}

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
        
        <div className="flex items-center gap-2 mb-1">
            {activeTab === 'preview' && (
                <button 
                    onClick={handleReload}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1C] hover:bg-[#333537] border border-[#444746] rounded text-[#E3E3E3] text-xs font-medium transition-colors"
                    title="Reload Preview"
                >
                    <ReloadIcon />
                </button>
            )}
            {/* Extract Button */}
            <button 
                onClick={handleExtract}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1C] hover:bg-[#333537] border border-[#444746] rounded text-[#E3E3E3] text-xs font-medium transition-colors"
                title="Save index.html to disk"
            >
                <DownloadIcon />
                <span className="hidden sm:inline">Extract</span>
            </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative smooth-transition">
        
        {/* Preview Mode */}
        <div className={`absolute inset-0 w-full h-full bg-white transition-opacity duration-300 ${activeTab === 'preview' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
            {canvasState.html ? (
                <iframe 
                    key={reloadKey} // Changing this key forces a remount/reload
                    srcDoc={getRenderedHtml()}
                    title="preview"
                    className="w-full h-full border-none"
                    sandbox="allow-scripts allow-modals"
                    style={{ backgroundColor: '#131314' }}
                />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 bg-[#131314]">
                    No code to preview yet. Ask Gemini to create something!
                </div>
            )}
        </div>

        {/* Code Mode - Editable (Single File) */}
        <div className={`absolute inset-0 w-full h-full bg-[#1E1F20] flex flex-col transition-opacity duration-300 ${activeTab === 'code' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
             
             {/* File Header */}
             <div className="flex bg-[#131314] border-b border-[#444746] px-4 py-1">
                 <span className="text-xs font-mono text-[#A8C7FA]">index.html</span>
             </div>

             {/* Editor Area */}
             <div className="relative flex-1 overflow-hidden">
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