import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SchemaBounceRequestError,
  exchangeToken,
  getAgentCard,
  getTask,
  isA2AErrorCode,
  listTasks,
  sendMessage,
  streamTask,
} from './client.js';
import { parseConfig } from './config.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function testConfig() {
  return parseConfig({
    apiUrl: 'https://api.schemabounce.com',
    workspaceId: 'ws_123',
    agentId: 'agent_123',
    clientId: 'client_123',
    clientSecret: 'super-secret-value',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exchangeToken', () => {
  it('sends Basic auth built from clientId:clientSecret and a client_credentials body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);

    const token = await exchangeToken(testConfig());

    expect(token).toBe('tok');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.schemabounce.com/api/v1/oauth/token');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('client_123:super-secret-value', 'utf8').toString('base64')}`
    );
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String((init as RequestInit).body)).toBe('grant_type=client_credentials');
  });

  it('throws SchemaBounceRequestError with the upstream error_description on a non-2xx response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error_description: 'invalid client credentials' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeToken(testConfig())).rejects.toMatchObject({
      name: 'SchemaBounceRequestError',
      code: 'http_error',
      status: 401,
      message: expect.stringContaining('invalid client credentials'),
    });
  });

  it('throws when the response has no access_token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ token_type: 'Bearer' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeToken(testConfig())).rejects.toMatchObject({ code: 'token_missing' });
  });
});

describe('sendMessage', () => {
  it('builds the message/send params with externalRef, wakeReason, and commentId', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'rpc-1',
        result: { id: 'task_1', contextId: 'ctx_1', status: { state: 'TASK_STATE_SUBMITTED' } },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await sendMessage(testConfig(), 'token-value', {
      prompt: 'Do the thing',
      paperclipTaskId: 'issue-9',
      paperclipRunId: 'run-9',
      wakeReason: 'issue_assigned',
      commentId: 'comment-1',
      contextId: 'ctx_prev',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.schemabounce.com/api/v1/a2a/ws_123/agent_123');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-value');
    const body = JSON.parse(String((init as RequestInit).body)) as {
      method: string;
      params: {
        message: { role: string; contextId: string; parts: Array<{ text?: { text: string } }> };
        metadata: Record<string, unknown>;
      };
    };
    expect(body.method).toBe('message/send');
    expect(body.params.message).toMatchObject({
      role: 'user',
      contextId: 'ctx_prev',
      parts: [{ text: { text: 'Do the thing' } }],
    });
    expect(body.params.metadata).toEqual({
      externalRef: { source: 'paperclip', externalId: 'issue-9' },
      paperclipRunId: 'run-9',
      wakeReason: 'issue_assigned',
      commentId: 'comment-1',
    });
  });

  it('omits contextId, wakeReason, and commentId when not supplied', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'rpc-1',
        result: { id: 'task_1', contextId: 'ctx_1', status: { state: 'TASK_STATE_SUBMITTED' } },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await sendMessage(testConfig(), 'token-value', {
      prompt: 'Do the thing',
      paperclipTaskId: 'issue-9',
      paperclipRunId: 'run-9',
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as {
      params: { message: Record<string, unknown>; metadata: Record<string, unknown> };
    };
    expect(body.params.message).not.toHaveProperty('contextId');
    expect(body.params.metadata).not.toHaveProperty('wakeReason');
    expect(body.params.metadata).not.toHaveProperty('commentId');
  });

  it('throws SchemaBounceRequestError when the RPC response carries a JSON-RPC error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'rpc-1',
        error: { code: -32602, message: 'message must contain at least one text part' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendMessage(testConfig(), 'token-value', {
        prompt: '',
        paperclipTaskId: 'issue-9',
        paperclipRunId: 'run-9',
      })
    ).rejects.toMatchObject({ code: 'a2a_-32602', message: 'message must contain at least one text part' });
  });

  // core-api returns a non-2xx HTTP status alongside the JSON-RPC error body
  // for context-busy (409) and conversation-unavailable (503) — see
  // core-api docs/A2A_PROTOCOL_SPECIFICATION.md §15 "contextId Contract".
  // The error code/message must still come from the JSON-RPC body, not a
  // generic "HTTP 409" message, and the HTTP status must be preserved on the
  // thrown error so callers can classify it (e.g. as transient_upstream).
  it('surfaces the JSON-RPC code and message for a 409 context-busy response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          jsonrpc: '2.0',
          id: 'rpc-1',
          error: {
            code: -32010,
            message: 'a previous message in this context is still being processed; wait for it to finish, then try again',
          },
        },
        409
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendMessage(testConfig(), 'token-value', {
        prompt: 'Do the thing',
        paperclipTaskId: 'issue-9',
        paperclipRunId: 'run-9',
        contextId: 'ctx_prev',
      })
    ).rejects.toMatchObject({
      name: 'SchemaBounceRequestError',
      code: 'a2a_-32010',
      status: 409,
      message: expect.stringContaining('still being processed'),
    });
  });

  it('surfaces the JSON-RPC code and message for a 503 conversation-unavailable response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          jsonrpc: '2.0',
          id: 'rpc-1',
          error: { code: -32011, message: 'conversation coordination temporarily unavailable, try again' },
        },
        503
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendMessage(testConfig(), 'token-value', {
        prompt: 'Do the thing',
        paperclipTaskId: 'issue-9',
        paperclipRunId: 'run-9',
        contextId: 'ctx_prev',
      })
    ).rejects.toMatchObject({
      name: 'SchemaBounceRequestError',
      code: 'a2a_-32011',
      status: 503,
      message: expect.stringContaining('temporarily unavailable'),
    });
  });

  it('falls back to a generic HTTP error when a non-2xx response has no JSON-RPC error shape', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendMessage(testConfig(), 'token-value', {
        prompt: 'Do the thing',
        paperclipTaskId: 'issue-9',
        paperclipRunId: 'run-9',
      })
    ).rejects.toMatchObject({ code: 'http_error', status: 504 });
  });
});

describe('getTask / listTasks / getAgentCard', () => {
  it('getTask requests tasks/get with the taskId', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'rpc-1',
        result: { id: 'task_1', contextId: 'ctx_1', status: { state: 'TASK_STATE_WORKING' } },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const task = await getTask(testConfig(), 'token-value', 'task_1');
    expect(task.status.state).toBe('TASK_STATE_WORKING');
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      method: string;
      params: { taskId: string };
    };
    expect(body.method).toBe('tasks/get');
    expect(body.params.taskId).toBe('task_1');
  });

  it('getAgentCard requests the agent-card.json endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ name: 'Hosted Worker' }));
    vi.stubGlobal('fetch', fetchMock);

    await getAgentCard(testConfig());
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.schemabounce.com/api/v1/a2a/ws_123/agent_123/agent-card.json'
    );
  });

  it('listTasks throws SchemaBounceRequestError on a non-2xx response with no JSON body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listTasks(testConfig(), 'token-value')).rejects.toBeInstanceOf(SchemaBounceRequestError);
  });
});

describe('streamTask', () => {
  it('parses SSE frames split across multiple reader chunks', async () => {
    const frame1 = 'data: {"taskId":"t1","contextId":"c1","artifact":{"parts":[{"text":{"text":"partial"}}],"index":0}}\n\n';
    const frame2 = 'data: {"taskId":"t1","contextId":"c1","status":{"state":"TASK_STATE_COMPLETED"},"final":true}\n\n';
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode(frame1.slice(0, 20)),
      encoder.encode(frame1.slice(20)),
      encoder.encode(frame2),
    ];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index]!);
          index += 1;
        } else {
          controller.close();
        }
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const events: unknown[] = [];
    await streamTask(testConfig(), 'token-value', 'task_1', async event => {
      events.push(event);
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ artifact: { parts: [{ text: { text: 'partial' } }] } });
    expect(events[1]).toMatchObject({ status: { state: 'TASK_STATE_COMPLETED' }, final: true });
  });

  it('throws when the stream response has no body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamTask(testConfig(), 'token-value', 'task_1', async () => undefined)).rejects.toMatchObject(
      { code: 'stream_body_missing' }
    );
  });
});

describe('isA2AErrorCode', () => {
  it('matches only the SchemaBounceRequestError carrying that exact a2a error code', () => {
    expect(isA2AErrorCode(new SchemaBounceRequestError('busy', 'a2a_-32010', 409), -32010)).toBe(true);
    expect(isA2AErrorCode(new SchemaBounceRequestError('unavailable', 'a2a_-32011', 503), -32010)).toBe(false);
    expect(isA2AErrorCode(new SchemaBounceRequestError('http', 'http_error', 504), -32010)).toBe(false);
    expect(isA2AErrorCode(new Error('plain error'), -32010)).toBe(false);
    expect(isA2AErrorCode('not an error', -32010)).toBe(false);
  });
});
