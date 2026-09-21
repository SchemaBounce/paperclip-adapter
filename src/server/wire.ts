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

// Documented in core-api docs/A2A_PROTOCOL_SPECIFICATION.md §15 "contextId
// Contract". Both codes are only ever returned by `message/send` (the row
// claim that binds a contextId to one conversation happens there, not on
// tasks/get, tasks/list, or tasks/cancel).
//
// -32010 context busy (HTTP 409): another send on the same (owner, contextId)
// is still in flight. The server refuses the send outright and terminalizes
// the run it had already created; nothing was left running.
//
// -32011 conversation unavailable (HTTP 503): the row-claim infrastructure
// (Postgres) could not be reached. The server fails closed rather than
// skipping the claim, which would let two concurrent sends interleave turns.
export const A2A_ERROR_CODE_CONTEXT_BUSY = -32010;
export const A2A_ERROR_CODE_CONVERSATION_UNAVAILABLE = -32011;

// Task.Metadata["continuity"] (core-api docs/A2A_PROTOCOL_SPECIFICATION.md
// §15 "Continuity signal", core-api T2.A Gap 2). Reports what memory the
// dispatched turn actually got:
//   - "resumed": a prior run on this SAME (owner, contextId) conversation
//     left a loadable session checkpoint; the agent's full working state was
//     restored.
//   - "history": no checkpoint was resumable, but the conversation's own
//     persisted transcript had prior turns, which were attached instead.
//   - "none": neither was available — first turn on a fresh context, a prior
//     run that left neither, or the transcript reader isn't wired.
//
// Set ONLY on the message/send response, after core-api's own dispatch
// decision, and only when the contextId Contract governed the send
// (conversationCoordinator wired). It is NOT persisted on the run, so a
// later tasks/get (or tasks/list) read of the SAME task never carries it —
// there is nothing to read on a poll. Absent entirely on servers that
// predate this feature.
export type A2AContinuity = 'resumed' | 'history' | 'none';

const KNOWN_A2A_CONTINUITY_VALUES: ReadonlySet<string> = new Set<A2AContinuity>([
  'resumed',
  'history',
  'none',
]);

// knownA2AContinuity narrows Task.Metadata["continuity"] down to a value
// this adapter recognizes. Returns undefined for both absence (older
// servers) and any value this adapter doesn't know about (a future addition
// on a newer server) — callers must treat both the same way: tolerate, don't
// guess, don't throw.
export function knownA2AContinuity(value: unknown): A2AContinuity | undefined {
  return typeof value === 'string' && KNOWN_A2A_CONTINUITY_VALUES.has(value)
    ? (value as A2AContinuity)
    : undefined;
}
