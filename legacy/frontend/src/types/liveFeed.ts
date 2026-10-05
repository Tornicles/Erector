export type LiveFeedEventType =
  | 'validation_created'
  | 'validation_state_changed'
  | 'context_started'
  | 'context_questions_generated'
  | 'context_answers_submitted'
  | 'context_blocked'
  | 'context_collected'
  | 'economic_stack_built'
  | 'engine_started'
  | 'engine_progress'
  | 'engine_completed'
  | 'engine_failed'
  | 'engine_fallback'
  | 'score_updated'
  | 'scoring_started'
  | 'scoring_completed'
  | 'recursive_challenge_started'
  | 'recursive_challenge_completed'
  | 'path_generation_started'
  | 'path_generation_completed'
  | 'report_ready'
  | 'validation_complete'
  | 'validation_failed'
  | 'validation_archived'
  | 'connection_established'
  | 'connection_resumed'
  | 'heartbeat'
  | 'error';

export type LiveFeedEventLevel = 'debug' | 'info' | 'success' | 'warning' | 'error' | 'critical';

export type WebSocketConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'active'
  | 'idle'
  | 'disconnected'
  | 'expired'
  | 'rejected';

export type WebSocketDisconnectReason =
  | 'client_closed'
  | 'auth_failed'
  | 'validation_not_found'
  | 'access_denied'
  | 'token_expired'
  | 'heartbeat_timeout'
  | 'server_shutdown'
  | 'duplicate_connection'
  | 'unknown_error';

export type EngineLiveStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'fallback' | 'skipped' | 'timed_out';

export type LiveFeedChannelType = 'validation' | 'user' | 'team' | 'admin' | 'system';

export interface LiveFeedProgress {
  current_stage?: string | null;
  percent_complete: number;
  total_engines: number;
  engines_pending: number;
  engines_running: number;
  engines_completed: number;
  engines_failed: number;
  engines_fallback: number;
  current_engine?: string | null;
  message?: string | null;
  updated_at: string;
}

export interface EngineLiveFeedItem {
  engine_name: string;
  engine_number: number;
  status: EngineLiveStatus;
  started_at?: string | null;
  completed_at?: string | null;
  execution_time_ms?: number | null;
  fallback_used: boolean;
  error_message?: string | null;
  latest_message?: string | null;
  progress_percent?: number | null;
}

export interface LiveFeedEvent {
  live_event_id: string;
  event_type: LiveFeedEventType;
  level: LiveFeedEventLevel;
  validation_id: string;
  owner_user_id: string;
  sequence_number: number;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  source: string;
  engine_name?: string | null;
  timestamp: string;
  replayable: boolean;
}

export interface ValidationLiveSnapshot {
  validation_id: string;
  validation_status: string;
  connected_clients: number;
  last_sequence_number: number;
  progress: LiveFeedProgress;
  engines: EngineLiveFeedItem[];
  latest_events: LiveFeedEvent[];
  generated_at: string;
}

export interface WebSocketErrorMessage {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  close_connection: boolean;
}

export interface WebSocketClientMessage {
  type: 'ping' | 'resume' | 'get_snapshot';
  payload?: Record<string, unknown>;
  client_timestamp?: string;
}

export interface WebSocketServerMessage {
  type: 'connection_established' | 'event' | 'snapshot' | 'pong' | 'error';
  connection_id: string;
  server_timestamp: string;
  sequence_number?: number;
  event?: LiveFeedEvent;
  snapshot?: ValidationLiveSnapshot;
  error?: WebSocketErrorMessage;
}

