import { create } from 'zustand';
import type { LiveFeedEvent, ValidationLiveSnapshot, WebSocketConnectionStatus, WebSocketServerMessage } from '../types/liveFeed';
import { connectToValidationLiveFeed } from '../services/liveFeedClient';

interface LiveFeedState {
  connectionStatus: WebSocketConnectionStatus;
  validationId: string | null;
  events: LiveFeedEvent[];
  snapshot: ValidationLiveSnapshot | null;
  lastSequenceReceived: number;
  error: any;
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

  connect: (validationId: string, token: string) => {
    connection?.disconnect();
    set({ connectionStatus: 'connecting', validationId, error: null });
    connection = connectToValidationLiveFeed({
      validationId,
      token,
      lastSequenceReceived: get().lastSequenceReceived,
      onMessage: (msg: WebSocketServerMessage) => {
        if (msg.type === 'connection_established' && msg.snapshot) {
          set({ connectionStatus: 'connected', snapshot: msg.snapshot });
        }
        if (msg.type === 'snapshot' && msg.snapshot) {
          set({ snapshot: msg.snapshot });
        }
        if (msg.type === 'event' && msg.event) {
          const seq = msg.event.sequence_number ?? 0;
          set((s) => ({
            events: [...s.events, msg.event as any],
            lastSequenceReceived: Math.max(s.lastSequenceReceived, seq),
          }));
        }
        if (msg.type === 'error') {
          set({ error: msg.error });
        }
      },
      onClose: () => set({ connectionStatus: 'disconnected' }),
    });
  },

  disconnect: () => {
    connection?.disconnect();
    connection = null;
    set({ connectionStatus: 'disconnected' });
  },

  clearEvents: () => set({ events: [], lastSequenceReceived: 0 }),
}));

