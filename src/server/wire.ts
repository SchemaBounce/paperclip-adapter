export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_AUTH_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_REJECTED';

export interface A2APart {
  text?: { text: string };
  data?: { data: unknown };
  file?: { name?: string; mimeType?: string; uri?: string; bytes?: string };
}

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index: number;
}

export interface A2ATaskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  provider?: string;
  modelId?: string;
  estimatedCostUsd?: number;
  reconciledCostUsd?: number;
  reconciliationState?: string;
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: TaskState; message?: string };
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown> & { usage?: A2ATaskUsage };
}

export interface A2ATaskStatusEvent {
  taskId: string;
  contextId: string;
  status: { state: TaskState; message?: string };
  final?: boolean;
}

export interface A2ATaskArtifactEvent {
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
}

export type A2AStreamEvent = A2ATaskStatusEvent | A2ATaskArtifactEvent;

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export const TERMINAL_STATES = new Set<TaskState>([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);
