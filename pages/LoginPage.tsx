import React, { useState } from 'react';
import { signInWithGoogle, signInGuest, simulateGoogleSignIn, isConfigured } from '../services/firebase';
import { SparklesIcon } from '../components/Icons';

const MockGoogleModal = ({ onClose }: { onClose: () => void }) => {
    const [step, setStep] = useState('select'); // select, logging-in

    const handleSelect = (email: string, name: string) => {
        setStep('logging-in');
        setTimeout(() => {
            simulateGoogleSignIn(email, name);
            onClose();
        }, 1500);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white text-black rounded-lg w-[400px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {step === 'select' && (
                    <>
                        <div className="p-8 pb-4 text-center border-b border-gray-100">
                             <div className="w-10 h-10 mx-auto mb-4">
                                <svg viewBox="0 0 24 24" className="w-full h-full">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                             </div>
                             <h2 className="text-xl font-medium text-gray-800">Sign in with Google</h2>
                             <p className="text-sm text-gray-500 mt-2">Choose an account to continue to GemGroupChat</p>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                             <button 
                                onClick={() => handleSelect('user@example.com', 'Demo User')}
                                className="w-full px-8 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors text-left border-b border-gray-100"
                             >
                                <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">D</div>
                                <div>
                                    <div className="font-medium text-gray-700">Demo User</div>
                                    <div className="text-sm text-gray-500">user@example.com</div>
                                </div>
                             </button>
                             <button 
                                onClick={() => handleSelect('admin@gemini.test', 'Admin User')}
                                className="w-full px-8 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors text-left border-b border-gray-100"
                             >
                                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">A</div>
                                <div>
                                    <div className="font-medium text-gray-700">Admin User</div>
                                    <div className="text-sm text-gray-500">admin@gemini.test</div>
                                </div>
                             </button>
                             <div className="px-8 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 text-gray-600">
                                <div className="w-8 h-8 flex items-center justify-center">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                </div>
                                <div className="font-medium">Use another account</div>
                             </div>
                        </div>
                    </>
                )}
                
                {step === 'logging-in' && (
                    <div className="p-12 flex flex-col items-center justify-center min-h-[300px]">
                        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <p className="text-gray-600">Signing in...</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const LoginPage = () => {
  const [showMockModal, setShowMockModal] = useState(false);

  const handleGoogleClick = async () => {
      // If configured, use real firebase, else show mock modal
      const success = await signInWithGoogle();
      if (!success && !isConfigured) {
          setShowMockModal(true);
      }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#131314] relative overflow-hidden">
        {/* Background Ambient Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="z-10 flex flex-col items-center max-w-sm w-full p-6 text-center space-y-8 animate-[fadeIn_0.8s_ease-out]">
            <div className="w-16 h-16 bg-[#1E1F20] rounded-2xl flex items-center justify-center shadow-lg border border-[#444746]">
                <SparklesIcon />
            </div>

            <div>
                <h1 className="text-3xl font-semibold text-[#E3E3E3] mb-2">Welcome to GemGroupChat</h1>
                <p className="text-[#C4C7C5]">Collaborate with Gemini AI alone or in groups.</p>
            </div>

            <div className="w-full space-y-4">
                <button 
                    onClick={handleGoogleClick}
                    className="w-full bg-[#4285F4] text-white py-3 rounded-full font-medium text-sm hover:bg-[#3367D6] transition-all duration-200 flex items-center justify-center gap-2 group shadow-[0_0_20px_rgba(66,133,244,0.3)]"
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" />
                        <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Sign in with Google
                </button>

                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-[#444746]"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-2 bg-[#131314] text-[#C4C7C5]">or</span>
                    </div>
                </div>

                <button 
                    onClick={signInGuest}
                    className="w-full bg-transparent border border-[#444746] text-[#E3E3E3] py-3 rounded-full font-medium text-sm hover:bg-[#333537] transition-all duration-200"
                >
                    Skip (Continue as Guest)
                </button>
            </div>
            
            <p className="text-xs text-[#C4C7C5] max-w-[250px]">
                By continuing, you agree to experience the Gemini 3 Flash Preview model in a cloned interface.
            </p>
        </div>
        
        {showMockModal && <MockGoogleModal onClose={() => setShowMockModal(false)} />}
    </div>
  );
};

export default LoginPage;