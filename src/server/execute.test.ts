import type { AdapterExecutionContext } from '@paperclipai/adapter-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execute } from './execute.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Shaped like the real Paperclip wake payload (@paperclipai/adapter-utils
// PaperclipWakePayload): ctx.context IS the payload, not wrapped under a key.
function context(): AdapterExecutionContext {
  return {
    runId: '9d80a453-4d5c-4dad-bcbe-73439020db80',
    agent: {
      id: 'paperclip-agent-1',
      companyId: 'paperclip-company-1',
      name: 'Hosted Worker',
      adapterType: 'schemabounce',
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: { a2aContextId: 'ctx_previous' },
      sessionDisplayId: 'ctx_previous',
      taskKey: 'issue-42',
    },
    config: {
      apiUrl: 'https://api.schemabounce.com',
      workspaceId: 'ws_123',
      agentId: 'agent_123',
      clientId: 'client_123',
      clientSecret: 'super-secret-value',
    },
    context: {
      reason: 'issue_assigned',
      issue: {
        id: 'issue-42',
        identifier: 'ENG-42',
        title: 'Prepare the release note',
        description: 'Ship notes for the upcoming release.',
        descriptionTruncated: false,
        status: 'in_progress',
        workMode: null,
        priority: null,
      },
      latestCommentId: 'comment-7',
      commentIds: ['comment-7'],
    },
    onLog: vi.fn(async () => undefined),
    onMeta: vi.fn(async () => undefined),
  } as AdapterExecutionContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function successFetchMock() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600 })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'rpc-1',
        result: {
          id: 'task_123',
          contextId: 'ctx_123',
          status: { state: 'TASK_STATE_SUBMITTED' },
        },
      })
    )
    .mockResolvedValueOnce(
      new Response(
        'data: {"taskId":"task_123","contextId":"ctx_123","artifact":{"parts":[{"text":{"text":"Release note ready"}}],"index":0}}\n\n' +
          'data: {"taskId":"task_123","contextId":"ctx_123","status":{"state":"TASK_STATE_COMPLETED"},"final":true}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    )
    .mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'rpc-2',
        result: {
          id: 'task_123',
          contextId: 'ctx_123',
          status: { state: 'TASK_STATE_COMPLETED' },
          metadata: {
            usage: {
              inputTokens: 120,
              outputTokens: 30,
              cacheReadTokens: 20,
              provider: 'anthropic',
              modelId: 'claude-sonnet',
              estimatedCostUsd: 0.02,
              reconciledCostUsd: 0.018,
              reconciliationState: 'reconciled',
            },
          },
        },
      })
    );
}

describe('execute', () => {
  it('exchanges a token via Basic auth before doing anything else', async () => {
    const fetchMock = successFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    await execute(context());

    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall?.[0]).toBeInstanceOf(URL);
    expect(String(tokenCall?.[0])).toBe('https://api.schemabounce.com/api/v1/oauth/token');
    const init = tokenCall?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('client_123:super-secret-value', 'utf8').toString('base64')}`
    );
    expect(String(init.body)).toBe('grant_type=client_credentials');
  });

  it('dispatches A2A work with externalRef, streams progress, and returns reconciled usage', async () => {
    const fetchMock = successFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const ctx = context();
    const result = await execute(ctx);

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 20 },
      usageBasis: 'per_run',
      sessionParams: { a2aContextId: 'ctx_123' },
      sessionDisplayId: 'ctx_123',
      provider: 'anthropic',
      model: 'claude-sonnet',
      costUsd: 0.018,
      summary: 'Release note ready',
    });

    const sendRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const rpcBody = JSON.parse(String(sendRequest?.body)) as {
      params: {
        message: { contextId: string; parts: Array<{ text?: { text: string } }> };
        metadata: Record<string, unknown>;
      };
    };
    expect(rpcBody.params.message.contextId).toBe('ctx_previous');
    // The prompt is built via the SDK's renderPaperclipWakePrompt, which
    // includes the issue title from the wake payload — proves the real
    // normalizePaperclipWakePayload/renderPaperclipWakePrompt wiring runs,
    // not a hand-rolled guess at ctx.context's shape.
    expect(rpcBody.params.message.parts[0]?.text?.text).toContain('Prepare the release note');
    expect(rpcBody.params.metadata).toMatchObject({
      externalRef: {
        source: 'paperclip',
        externalId: 'issue-42',
      },
      paperclipRunId: ctx.runId,
      wakeReason: 'issue_assigned',
      commentId: 'comment-7',
    });
    // No url field was supplied (the wake payload has no URL to build one
    // from), so externalRef.url must be entirely absent, not present-and-empty.
    expect(rpcBody.params.metadata.externalRef).not.toHaveProperty('url');
  });

  it('forwards SSE stream frames to onLog as they arrive', async () => {
    const fetchMock = successFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const ctx = context();
    await execute(ctx);

    const onLog = ctx.onLog as unknown as ReturnType<typeof vi.fn>;
    const stdoutLines = onLog.mock.calls
      .filter(call => call[0] === 'stdout')
      .map(call => String(call[1]));
    expect(stdoutLines.some(line => line.includes('Release note ready'))).toBe(true);
    expect(stdoutLines.some(line => line.includes('TASK_STATE_COMPLETED'))).toBe(true);
    expect(stdoutLines.some(line => line.includes('"kind":"dispatch"') && line.includes('task_123'))).toBe(
      true
    );
  });

  it('falls back to the runtime task key when the wake payload has no issue', async () => {
    const fetchMock = successFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const ctx = context();
    ctx.context = {};

    await execute(ctx);

    const sendRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const rpcBody = JSON.parse(String(sendRequest?.body)) as {
      params: { metadata: { externalRef: { externalId: string } } };
    };
    expect(rpcBody.params.metadata.externalRef.externalId).toBe('issue-42');
  });

  it('times out and cancels the task when the run exceeds timeoutSec', async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600 })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 'rpc-1',
          result: { id: 'task_123', contextId: 'ctx_123', status: { state: 'TASK_STATE_SUBMITTED' } },
        })
      )
      .mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = (init as RequestInit | undefined)?.signal;
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          })
      )
      // Best-effort cancelTask call after the timeout.
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 'rpc-3',
          result: { id: 'task_123', contextId: 'ctx_123', status: { state: 'TASK_STATE_CANCELED' } },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const ctx = context();
    ctx.config = { ...ctx.config, timeoutSec: 30 };

    const resultPromise = execute(ctx);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await resultPromise;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe('timeout');
  });

  it('never exposes the client secret or bearer token to onLog or onMeta', async () => {
    const fetchMock = successFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const ctx = context();
    await execute(ctx);

    const onLog = ctx.onLog as unknown as ReturnType<typeof vi.fn>;
    const onMeta = ctx.onMeta as unknown as ReturnType<typeof vi.fn>;
    const loggedText = onLog.mock.calls.map(call => String(call[1])).join('\n');
    const metaText = JSON.stringify(onMeta.mock.calls);

    expect(loggedText).not.toContain('super-secret-value');
    expect(loggedText).not.toContain('access-token');
    expect(metaText).not.toContain('super-secret-value');
    expect(metaText).not.toContain('access-token');
  });

  // core-api docs/A2A_PROTOCOL_SPECIFICATION.md §15 "contextId Contract":
  // message/send refuses a send that races another in-flight send on the
  // same (owner, contextId) with -32010 (HTTP 409) rather than queueing it
  // invisibly. The adapter must report this as a non-fatal failed heartbeat
  // (not a crash, not a reason to drop the stored contextId) so the next
  // heartbeat continues the same conversation.
  describe('context-busy (-32010)', () => {
    function busyFetchMock() {
      return vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600 })
        )
        .mockResolvedValueOnce(
          jsonResponse(
            {
              jsonrpc: '2.0',
              id: 'rpc-1',
              error: {
                code: -32010,
                message:
                  'a previous message in this context is still being processed; wait for it to finish, then try again',
              },
            },
            409
          )
        );
    }

    it('returns a non-fatal failed heartbeat and keeps the stored contextId', async () => {
      const fetchMock = busyFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const result = await execute(context());

      expect(result.exitCode).toBe(1);
      expect(result.timedOut).toBe(false);
      expect(result.errorCode).toBe('a2a_-32010');
      expect(result.errorMessage).toContain('still working on the previous turn');
      expect(result.sessionParams).toEqual({ a2aContextId: 'ctx_previous' });
      expect(result.sessionDisplayId).toBe('ctx_previous');
      // Only two calls: token exchange and the refused send. No stream, no
      // getTask, no tight retry loop.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('never exposes the client secret or bearer token in the busy failure', async () => {
      const fetchMock = busyFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const ctx = context();
      const result = await execute(ctx);

      const onLog = ctx.onLog as unknown as ReturnType<typeof vi.fn>;
      const onMeta = ctx.onMeta as unknown as ReturnType<typeof vi.fn>;
      const loggedText = onLog.mock.calls.map(call => String(call[1])).join('\n');
      const metaText = JSON.stringify(onMeta.mock.calls);
      const resultText = JSON.stringify(result);

      expect(loggedText).not.toContain('super-secret-value');
      expect(loggedText).not.toContain('access-token');
      expect(metaText).not.toContain('super-secret-value');
      expect(metaText).not.toContain('access-token');
      expect(resultText).not.toContain('super-secret-value');
      expect(resultText).not.toContain('access-token');
    });

    it('has no stored contextId to preserve on a first-ever heartbeat and omits sessionParams', async () => {
      const fetchMock = busyFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const ctx = context();
      ctx.runtime = { ...ctx.runtime, sessionParams: null, sessionDisplayId: null };

      const result = await execute(ctx);

      expect(result.errorCode).toBe('a2a_-32010');
      expect(result.sessionParams).toBeUndefined();
    });
  });

  // -32011 (HTTP 503) is a transient infrastructure failure in the
  // conversation row-claim (Postgres unreachable), distinct from busy: the
  // server fails closed rather than skipping the claim. Also non-fatal, also
  // keeps the stored contextId.
  describe('conversation-unavailable (-32011)', () => {
    function unavailableFetchMock() {
      return vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600 })
        )
        .mockResolvedValueOnce(
          jsonResponse(
            {
              jsonrpc: '2.0',
              id: 'rpc-1',
              error: {
                code: -32011,
                message: 'conversation coordination temporarily unavailable, try again',
              },
            },
            503
          )
        );
    }

    it('returns a transient failed heartbeat and keeps the stored contextId', async () => {
      const fetchMock = unavailableFetchMock();
      vi.stubGlobal('fetch', fetchMock);

      const result = await execute(context());

      expect(result.exitCode).toBe(1);
      expect(result.errorCode).toBe('a2a_-32011');
      expect(result.errorFamily).toBe('transient_upstream');
      expect(result.sessionParams).toEqual({ a2aContextId: 'ctx_previous' });
      expect(result.sessionDisplayId).toBe('ctx_previous');
    });
  });
});
