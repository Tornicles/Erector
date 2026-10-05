import { create } from 'zustand';
import type { LiveFeedEvent, ValidationLiveSnapshot, WebSocketConnectionStatus } from '../types/liveFeed';
import { connectToValidationLiveFeed } from '../services/liveFeedClient';

interface LiveFeedState {
  connectionStatus: WebSocketConnectionStatus;
  validationId: string | null;
  events: LiveFeedEvent[];
  snapshot: ValidationLiveSnapshot | null;
  lastSequenceReceived: number;
  error: any;
  connectedAt: number | null;
  disconnectedAt: number | null;
  connect: (validationId: string, token: string) => void;
  disconnect: () => void;
  clearEvents: () => void;
}

let connection: ReturnType<typeof connectToValidationLiveFeed> | null = null;

export const useLiveFeedStore = create<LiveFeedState>((set, get) => ({
  connectionStatus: 'disconnected',
  validationId: null,
  events: [],
  snapshot: null,
  lastSequenceReceived: 0,
  error: null,
  connectedAt: null,
  disconnectedAt: null,

  connect: (validationId: string, token: string) => {
    connection?.disconnect();
    set({ connectionStatus: 'connecting', validationId, error: null });
    connection = connectToValidationLiveFeed({
      validationId,
      token,
      lastSequenceReceived: get().lastSequenceReceived,
      onConnected: () => set({ connectionStatus: 'connected', connectedAt: Date.now() }),
      onSnapshot: (snapshot) => set({ snapshot }),
      onEvent: (event) => {
        const seq = event.sequence_number ?? 0;
        set((s) => ({
          events: [...s.events, event],
          lastSequenceReceived: Math.max(s.lastSequenceReceived, seq),
        }));
      },
      onError: (err) => set({ error: err }),
      onDisconnected: () => set({ connectionStatus: 'disconnected', disconnectedAt: Date.now() }),
    });
  },

  disconnect: () => {
    connection?.disconnect();
    connection = null;
    set({ connectionStatus: 'disconnected' });
  },

  clearEvents: () => set({ events: [], lastSequenceReceived: 0 }),
}));

