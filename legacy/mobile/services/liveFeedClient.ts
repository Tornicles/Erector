import type { WebSocketClientMessage } from '../types/liveFeed';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

function toWsUrl(httpBase: string): string {
  if (!httpBase) return '';
  if (httpBase.startsWith('https://')) return httpBase.replace('https://', 'wss://');
  if (httpBase.startsWith('http://')) return httpBase.replace('http://', 'ws://');
  return httpBase;
}

export function connectToValidationLiveFeed(opts: {
  validationId: string;
  token: string;
  lastSequenceReceived?: number;
  onMessage: (msg: any) => void;
  onClose?: () => void;
  autoReconnect?: boolean;
}) {
  const base = toWsUrl(BASE_URL);
  const params = new URLSearchParams();
  params.set('token', opts.token);
  if (opts.lastSequenceReceived != null) params.set('last_sequence_received', String(opts.lastSequenceReceived));
  const url = `${base}/api/v1/validations/${encodeURIComponent(opts.validationId)}/live?${params.toString()}`;

  let ws: WebSocket | null = null;
  let heartbeat: any = null;
  let reconnectAttempts = 0;
  const autoReconnect = opts.autoReconnect ?? true;

  const send = (msg: WebSocketClientMessage) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      reconnectAttempts = 0;
      heartbeat = setInterval(() => send({ type: 'ping', payload: {} }), 25000);
    };
    ws.onmessage = (ev) => {
      try {
        opts.onMessage(JSON.parse(String(ev.data)));
      } catch {
        // ignore parse failures
      }
    };
    ws.onclose = () => {
      if (heartbeat) clearInterval(heartbeat);
      opts.onClose?.();
      if (!autoReconnect) return;
      reconnectAttempts += 1;
      const backoff = Math.min(10000, 500 * reconnectAttempts);
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

