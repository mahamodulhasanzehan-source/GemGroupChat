import { useState, useRef, useEffect, useCallback } from 'react';
import Peer from 'peerjs';
import { Group } from '../types';
import { setGroupCallState, joinCallSession, leaveCallSession, endGroupCall } from '../services/firebase';

interface UseGroupCallProps {
    currentUser: any;
    groupId: string | undefined;
    groupDetails: Group | null;
}

export const useGroupCall = ({ currentUser, groupId, groupDetails }: UseGroupCallProps) => {
    const [isInCall, setIsInCall] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [visualizerData, setVisualizerData] = useState<number[]>(new Array(5).fill(10));
    const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);

    const peerRef = useRef<Peer | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const callsRef = useRef<any[]>([]);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const sourceNodesRef = useRef<MediaStreamAudioSourceNode[]>([]);

    // Cleanup function
    const cleanupCall = useCallback(async () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        
        if (audioContextRef.current) {
            try { await audioContextRef.current.close(); } catch(e) {}
            audioContextRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        sourceNodesRef.current = [];

        callsRef.current.forEach(call => call.close());
        callsRef.current = [];
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        
        setRemoteStreams([]);
        setIsInCall(false);
        setVisualizerData(new Array(5).fill(10));

        if (groupId && currentUser) {
            await leaveCallSession(groupId, currentUser.uid);
        }
    }, [groupId, currentUser]);

    // Audio Visualizer Setup
    const setupAudioMixing = (localStream: MediaStream) => {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass({ latencyHint: 'interactive', sampleRate: 48000 });
            audioContextRef.current = audioCtx;

            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 32;
            analyserRef.current = analyser;

            const masterGain = audioCtx.createGain();
            masterGain.connect(analyser);

            const localSource = audioCtx.createMediaStreamSource(localStream);
            localSource.connect(masterGain);
            sourceNodesRef.current.push(localSource);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateVisualizer = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getByteFrequencyData(dataArray);
                
                const points = [dataArray[0], dataArray[2], dataArray[4], dataArray[6], dataArray[8]]
                    .map(val => Math.max(10, val / 2.55));

                setVisualizerData(points);
                animationFrameRef.current = requestAnimationFrame(updateVisualizer);
            };
            updateVisualizer();
        } catch (e) {
            console.error("Audio Context setup failed", e);
        }
    };

    const addStreamToMixer = (stream: MediaStream) => {
        if (!audioContextRef.current || !analyserRef.current) return;
        try {
            const source = audioContextRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current); 
            sourceNodesRef.current.push(source);
        } catch (e) {
            console.error("Error adding stream to mixer", e);
        }
    };

    const handleCallStream = (call: any) => {
        call.on('stream', (remoteStream: MediaStream) => {
            setRemoteStreams(prev => [...prev, remoteStream]);
            addStreamToMixer(remoteStream);
        });
    };

    const connectToPeer = (peerId: string, stream: MediaStream) => {
        if (!peerRef.current) return;
        const call = peerRef.current.call(peerId, stream);
        if (call) {
            handleCallStream(call);
            callsRef.current.push(call);
        }
    };

    const joinCall = async () => {
        if (!groupId || !currentUser) return;

        try {
            const constraints: any = {
                audio: { 
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    latency: 0,
                    sampleRate: 48000
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            localStreamRef.current = stream;
            setIsMuted(false);

            const peer = new Peer(currentUser.uid);
            peerRef.current = peer;

            peer.on('open', async (id) => {
                await joinCallSession(groupId, currentUser.uid);
                setIsInCall(true);
                
                if (groupDetails?.callParticipants) {
                    groupDetails.callParticipants.forEach(pid => {
                        if (pid !== currentUser.uid) {
                            connectToPeer(pid, stream);
                        }
                    });
                }
            });

            peer.on('call', (call) => {
                call.answer(stream); 
                handleCallStream(call);
                callsRef.current.push(call);
            });
            
            setupAudioMixing(stream);

        } catch (e) {
            console.error("Failed to join call", e);
            alert("Could not access microphone or connect to peer server.");
            cleanupCall();
        }
    };

    const toggleMute = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsMuted(prev => !prev);
        }
    };

    const handleCallAction = async () => {
        if (!groupId) return;
        if (groupDetails?.isCallActive) {
            await joinCall();
        } else {
            if (confirm("Start a group call?")) {
                await setGroupCallState(groupId, true, currentUser.uid);
                joinCall();
            }
        }
    };

    const handleEndForEveryone = async () => {
        if (confirm("Do you want to end the call for everyone?") && groupId) {
            await endGroupCall(groupId);
        }
    };

    // Auto-leave if remote call ends
    useEffect(() => {
        if (groupDetails && groupDetails.isCallActive === false && isInCall) {
            cleanupCall();
            alert("The call has been ended by the host.");
        }
    }, [groupDetails?.isCallActive, isInCall, cleanupCall]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isInCall) cleanupCall();
        };
    }, []); // Run only on unmount manually inside the effect logic

    return {
        isInCall,
        isMuted,
        visualizerData,
        remoteStreams,
        joinCall,
        leaveCall: cleanupCall,
        toggleMute,
        handleCallAction,
        handleEndForEveryone
    };
};
