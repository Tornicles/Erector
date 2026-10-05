import type { WebSocketClientMessage, WebSocketServerMessage } from '../types/liveFeed';

function toWsUrl(httpBase: string): string {
  if (!httpBase) return '';
  if (httpBase.startsWith('https://')) return httpBase.replace('https://', 'wss://');
  if (httpBase.startsWith('http://')) return httpBase.replace('http://', 'ws://');
  return httpBase;
}

export interface ConnectLiveFeedOptions {
  validationId: string;
  token: string;
  lastSequenceReceived?: number;
  onConnected?: (connectionId: string) => void;
  onSnapshot?: (snapshot: any) => void;
  onEvent?: (event: any) => void;
  onError?: (err: any) => void;
  onDisconnected?: () => void;
  onReconnect?: () => void;
  autoReconnect?: boolean;
}

export function connectToValidationLiveFeed(opts: ConnectLiveFeedOptions) {
  const base = toWsUrl(process.env.REACT_APP_BACKEND_URL || '');
  const params = new URLSearchParams();
  params.set('token', opts.token);
  if (opts.lastSequenceReceived != null) params.set('last_sequence_received', String(opts.lastSequenceReceived));
  const url = `${base}/api/v1/validations/${encodeURIComponent(opts.validationId)}/live?${params.toString()}`;

  let ws: WebSocket | null = null;
  let heartbeat: any = null;
  let reconnectAttempts = 0;
  const autoReconnect = opts.autoReconnect ?? true;

  const send = (msg: WebSocketClientMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectAttempts = 0;
      heartbeat = setInterval(() => send({ type: 'ping', payload: {} }), 25000);
    };
    ws.onmessage = (ev) => {
      let msg: WebSocketServerMessage | null = null;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        opts.onError?.({ code: 'PARSE_ERROR' });
        return;
      }
      if (!msg) return;
      if (msg.type === 'connection_established') {
        opts.onConnected?.(msg.connection_id);
        if (msg.snapshot) opts.onSnapshot?.(msg.snapshot);
      } else if (msg.type === 'snapshot') {
        if (msg.snapshot) opts.onSnapshot?.(msg.snapshot);
      } else if (msg.type === 'event') {
        if (msg.event) opts.onEvent?.(msg.event);
      } else if (msg.type === 'error') {
        opts.onError?.(msg.error);
      }
    };
    ws.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      opts.onDisconnected?.();
      if (!autoReconnect) return;
      reconnectAttempts += 1;
      const backoff = Math.min(10000, 500 * reconnectAttempts);
      opts.onReconnect?.();
      setTimeout(connect, backoff);
    };
  };

  connect();

  return {
    disconnect: () => {
      if (heartbeat) clearInterval(heartbeat);
      ws?.close();
      ws = null;
    },
    resume: (lastSequenceReceived: number) => send({ type: 'resume', payload: { last_sequence_received: lastSequenceReceived } }),
    getSnapshot: () => send({ type: 'get_snapshot', payload: {} }),
  };
}

