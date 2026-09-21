import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from '@paperclipai/adapter-utils';
// normalizePaperclipWakePayload / renderPaperclipWakePrompt live in the
// server-utils subpath, not the package root — the root index.d.ts does not
// re-export them (verified against the published dist).
import { normalizePaperclipWakePayload, renderPaperclipWakePrompt } from '@paperclipai/adapter-utils/server-utils';
import {
  cancelTask,
  exchangeToken,
  getTask,
  isA2AErrorCode,
  SchemaBounceRequestError,
  sendMessage,
  streamTask,
} from './client.js';
import { parseConfig } from './config.js';
import {
  A2A_ERROR_CODE_CONTEXT_BUSY,
  A2A_ERROR_CODE_CONVERSATION_UNAVAILABLE,
  knownA2AContinuity,
  TERMINAL_STATES,
  type A2AStreamEvent,
  type A2ATask,
  type TaskState,
} from './wire.js';

const LOG_PREFIX = '[schemabounce] ';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// taskIdentity reads the real Paperclip wake-payload shape through the SDK's
// own normalizePaperclipWakePayload. ctx.context IS the wake payload itself
// (not wrapped under a key) — confirmed against @paperclipai/adapter-utils'
// published server-utils.d.ts (PaperclipWakePayload / PaperclipWakeIssue) and
// renderPaperclipWakePrompt's own implementation, which calls
// normalizePaperclipWakePayload(value) on the same `value` it receives.
// normalizePaperclipWakePayload returns null for a context with no
// recognizable wake shape, so every field below has a defensive fallback.
function taskIdentity(ctx: AdapterExecutionContext) {
  const wake = normalizePaperclipWakePayload(ctx.context);
  const taskId =
    stringValue(wake?.issue?.id ?? undefined) ??
    stringValue(ctx.runtime.taskKey ?? undefined) ??
    ctx.runId;
  return {
    taskId,
    wakeReason: stringValue(wake?.reason ?? undefined),
    commentId: stringValue(wake?.latestCommentId ?? undefined),
  };
}

// buildPrompt defers to the SDK's own renderPaperclipWakePrompt for the
// issue/comment/recovery/plan-review narrative — it already encodes the full
// PaperclipWakePayload shape (recovery causes, liveness continuations, plan
// review threads, checkbox confirmations, etc.) that this adapter has no
// business re-deriving from scratch. This adapter only prepends the
// SchemaBounce-specific identity header. renderPaperclipWakePrompt returns ""
// when ctx.context carries no wake shape (e.g. a minimal test harness call),
// so the header-only prompt is still meaningful on its own.
function buildPrompt(ctx: AdapterExecutionContext): string {
  const rendered = renderPaperclipWakePrompt(ctx.context, { includeExecutionContract: true });
  const header = [
    `You are ${ctx.agent.name}, a SchemaBounce hosted agent working for a Paperclip-managed company.`,
    '',
    `Paperclip company ID: ${ctx.agent.companyId}`,
    `Paperclip agent ID: ${ctx.agent.id}`,
    `Paperclip run ID: ${ctx.runId}`,
    '',
    'Use the Paperclip MCP connection to check out work and update its status. Do not expose credentials in output.',
  ].join('\n');
  return rendered ? `${header}\n\n${rendered}` : header;
}

// AdapterExecutionContext carries no AbortSignal — verified against
// @paperclipai/adapter-utils' published .d.ts, which has no `signal` field on
// the context (only AdapterExecutionResult.signal, the OS termination signal
// reported back to Paperclip). This adapter's only cancellation source is
// therefore its own config.timeoutSec.
function createTimeoutSignal(timeoutSec: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('SchemaBounce worker timed out'));
  }, timeoutSec * 1000);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => clearTimeout(timer),
  };
}

function isArtifactEvent(event: A2AStreamEvent): event is A2AStreamEvent & { artifact: NonNullable<A2ATask['artifacts']>[number] } {
  return 'artifact' in event;
}

function eventText(event: A2AStreamEvent): string[] {
  if (!isArtifactEvent(event)) return [];
  return event.artifact.parts.flatMap(part => (part.text?.text ? [part.text.text] : []));
}

async function delay(ms: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function waitForTerminalTask(
  ctx: AdapterExecutionContext,
  config: ReturnType<typeof parseConfig>,
  token: string,
  initialTask: A2ATask,
  signal: AbortSignal
): Promise<{ task: A2ATask; streamedText: string[] }> {
  let finalState: TaskState | undefined;
  const streamedText: string[] = [];
  const onEvent = async (event: A2AStreamEvent) => {
    await ctx.onLog('stdout', `${LOG_PREFIX}${JSON.stringify(event)}\n`);
    streamedText.push(...eventText(event));
    if ('status' in event && (event.final || TERMINAL_STATES.has(event.status.state))) {
      finalState = event.status.state;
    }
  };

  await streamTask(config, token, initialTask.id, onEvent, signal);
  let task = await getTask(config, token, initialTask.id, signal);
  while (!finalState && !TERMINAL_STATES.has(task.status.state)) {
    await delay(1000, signal);
    task = await getTask(config, token, initialTask.id, signal);
  }
  return { task, streamedText };
}

// logContinuity writes the A2A continuity signal (see knownA2AContinuity in
// wire.ts) to Paperclip's run log. It never touches the returned
// AdapterExecutionResult — no result field exists for this, and the sole
// consequence of "none" (no memory this turn) is informational, not a
// reason to fail the heartbeat or drop the stored contextId.
async function logContinuity(
  ctx: AdapterExecutionContext,
  dispatchTask: A2ATask,
  sentStoredContextId: string | undefined
): Promise<void> {
  const raw = dispatchTask.metadata?.continuity;
  if (typeof raw !== 'string' || !raw.trim()) return; // absent — older server, or the contextId Contract wasn't in play.

  await ctx.onLog(
    'stdout',
    `${LOG_PREFIX}${JSON.stringify({ kind: 'continuity', value: raw, taskId: dispatchTask.id, contextId: dispatchTask.contextId })}\n`
  );

  const known = knownA2AContinuity(raw);
  if (known === 'none' && sentStoredContextId) {
    await ctx.onLog(
      'stdout',
      `${LOG_PREFIX}This turn ran without memory of earlier turns in this conversation, even though a prior context (${sentStoredContextId}) was sent. The agent started fresh; this is informational, not an error, and the stored context continues to the next heartbeat.\n`
    );
  }
}

function resultForTask(task: A2ATask, streamedText: string[]): AdapterExecutionResult {
  const usage = task.metadata?.usage;
  const completed = task.status.state === 'TASK_STATE_COMPLETED';
  const costUsd =
    usage?.reconciliationState === 'reconciled'
      ? usage.reconciledCostUsd
      : usage?.estimatedCostUsd;
  const summary =
    streamedText.join('').trim() ||
    task.artifacts
      ?.flatMap(artifact => artifact.parts)
      .flatMap(part => (part.text?.text ? [part.text.text] : []))
      .join('\n')
      .trim() ||
    task.status.message ||
    `SchemaBounce task ${task.status.state.toLowerCase()}`;

  return {
    exitCode: completed ? 0 : 1,
    signal: null,
    timedOut: false,
    ...(completed
      ? {}
      : {
          errorCode: 'schemabounce_task_failed',
          errorMessage: task.status.message ?? `SchemaBounce task ended in ${task.status.state}`,
        }),
    usage: usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cacheReadTokens,
        }
      : undefined,
    usageBasis: 'per_run',
    sessionParams: { a2aContextId: task.contextId },
    sessionDisplayId: task.contextId,
    provider: usage?.provider,
    model: usage?.modelId,
    billingType: 'credits',
    costUsd,
    summary,
    resultJson: {
      schemaBounceTaskId: task.id,
      a2aContextId: task.contextId,
      state: task.status.state,
    },
  };
}

// priorContextId is the a2aContextId this run already had stored (from
// ctx.runtime.sessionParams) before this call started. -32010/-32011 both
// come from message/send's conversation row-claim (core-api
// docs/A2A_PROTOCOL_SPECIFICATION.md §15 "contextId Contract") failing
// BEFORE the server dispatches a new turn — the conversation itself, and the
// contextId that names it, are untouched. Dropping the stored contextId here
// would start a brand-new conversation on the next heartbeat for no reason;
// keeping it lets the next heartbeat resume exactly where this one left off.
function failureResult(error: unknown, timedOut: boolean, priorContextId?: string): AdapterExecutionResult {
  const message = error instanceof Error ? error.message : String(error);
  const busy = isA2AErrorCode(error, A2A_ERROR_CODE_CONTEXT_BUSY);
  const unavailable = isA2AErrorCode(error, A2A_ERROR_CODE_CONVERSATION_UNAVAILABLE);

  return {
    exitCode: 1,
    signal: null,
    timedOut,
    errorCode:
      error instanceof SchemaBounceRequestError ? error.code : timedOut ? 'timeout' : 'schemabounce_error',
    errorMessage: busy
      ? `The agent is still working on the previous turn in this conversation, so this heartbeat did not start a new one. It will pick up on the next heartbeat. (${message})`
      : message,
    errorFamily:
      error instanceof SchemaBounceRequestError && (error.status === 429 || (error.status ?? 0) >= 500)
        ? 'transient_upstream'
        : null,
    ...((busy || unavailable) && priorContextId
      ? { sessionParams: { a2aContextId: priorContextId }, sessionDisplayId: priorContextId }
      : {}),
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  let config: ReturnType<typeof parseConfig>;
  try {
    config = parseConfig(ctx.config);
  } catch (error) {
    return failureResult(error, false);
  }

  const runSignal = createTimeoutSignal(config.timeoutSec);
  // Read before the try block so it is still available in the catch below —
  // it names the conversation this run is (or would be) part of, and a
  // context-busy/conversation-unavailable failure needs to report it back
  // unchanged (see failureResult).
  const sessionContextId = stringValue(ctx.runtime.sessionParams?.a2aContextId);
  let token: string | undefined;
  let task: A2ATask | undefined;
  try {
    await ctx.onMeta?.({
      adapterType: 'schemabounce',
      command: 'SchemaBounce Hosted Agent Worker',
      commandNotes: ['OAuth client credentials', 'A2A message/send', 'A2A task SSE'],
      context: {
        workspaceId: config.workspaceId,
        agentId: config.agentId,
        paperclipRunId: ctx.runId,
      },
    });

    token = await exchangeToken(config, runSignal.signal);
    const identity = taskIdentity(ctx);
    task = await sendMessage(
      config,
      token,
      {
        prompt: buildPrompt(ctx),
        paperclipTaskId: identity.taskId,
        contextId: sessionContextId,
        wakeReason: identity.wakeReason,
        commentId: identity.commentId,
        paperclipRunId: ctx.runId,
      },
      runSignal.signal
    );
    await ctx.onLog(
      'stdout',
      `${LOG_PREFIX}${JSON.stringify({ kind: 'dispatch', taskId: task.id, contextId: task.contextId })}\n`
    );
    // The continuity signal (if any) is only ever on THIS response — the
    // immediate result of message/send. core-api never repeats it on a
    // later tasks/get read of the same task (see knownA2AContinuity in
    // wire.ts), so it must be logged here, at dispatch time, not after
    // waitForTerminalTask polls tasks/get to a terminal state.
    await logContinuity(ctx, task, sessionContextId);

    const terminal = await waitForTerminalTask(ctx, config, token, task, runSignal.signal);
    return resultForTask(terminal.task, terminal.streamedText);
  } catch (error) {
    if (task && token && runSignal.timedOut()) {
      try {
        await cancelTask(config, token, task.id, AbortSignal.timeout(5000));
      } catch {
        // Cancellation is best effort after the run has already stopped.
      }
    }
    return failureResult(error, runSignal.timedOut(), sessionContextId);
  } finally {
    runSignal.cleanup();
  }
}
