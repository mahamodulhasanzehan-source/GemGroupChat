import React from 'react';
import { signInWithGoogle, signInGuest } from '../services/firebase';
import { SparklesIcon } from '../components/Icons';

const LoginPage = () => {

  const handleGoogleClick = async () => {
      // Direct call to Firebase Service
      await signInWithGoogle();
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
    </div>
  );
};

export default LoginPage;