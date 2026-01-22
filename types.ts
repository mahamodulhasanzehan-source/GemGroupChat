
export interface UserProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
}

export interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  role: 'user' | 'model' | 'system';
  isLoading?: boolean;
  status?: 'queued' | 'generating' | 'done'; // For queue management
  audioData?: string | null; // Base64 Audio data for persistence
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  groupId?: string; // If it belongs to a group
}

export interface Group {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  members: string[]; // array of UIDs
  lockedBy?: string | null; // UID of user currently editing/prompting
  lockedAt?: number;
  processingMessageId?: string | null; // ID of the message currently being processed by AI
}

export interface CanvasState {
  html: string;
  css: string;
  js: string;
  lastUpdated: number;
  terminalOutput: string[]; // For the terminal view
}

export interface Presence {
    uid: string;
    displayName: string;
    lastActive: number;
    isOnline: boolean;
}

export enum ViewState {
  LOGIN,
  CHAT,
  GROUP_SETUP
}