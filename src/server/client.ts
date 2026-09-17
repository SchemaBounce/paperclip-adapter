import { apiPath, type SchemaBounceAdapterConfig } from './config.js';
import type { A2AStreamEvent, A2ATask, JsonRpcResponse } from './wire.js';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class SchemaBounceRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'SchemaBounceRequestError';
  }
}

function a2aEndpoint(config: SchemaBounceAdapterConfig): URL {
  return apiPath(
    config,
    `/api/v1/a2a/${encodeURIComponent(config.workspaceId)}/${encodeURIComponent(config.agentId)}`
  );
}

async function errorForResponse(response: Response, operation: string) {
  let message = `${operation} failed with HTTP ${response.status}`;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const detail = body.error_description ?? body.message ?? body.error;
    if (typeof detail === 'string' && detail.trim()) message = `${operation} failed: ${detail}`;
  } catch {
    // The status is enough when the upstream response is not JSON.
  }
  return new SchemaBounceRequestError(message, 'http_error', response.status);
}

export async function exchangeToken(
  config: SchemaBounceAdapterConfig,
  signal?: AbortSignal
): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString(
    'base64'
  );
  const response = await fetch(apiPath(config, '/api/v1/oauth/token'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal,
  });
  if (!response.ok) throw await errorForResponse(response, 'SchemaBounce token exchange');
  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) {
    throw new SchemaBounceRequestError(
      'SchemaBounce token exchange returned no access token',
      'token_missing'
    );
  }
  return token.access_token;
}

export async function rpc<T>(
  config: SchemaBounceAdapterConfig,
  token: string,
  method: string,
  params: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(a2aEndpoint(config), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
    signal,
  });
  if (!response.ok) throw await errorForResponse(response, method);
  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new SchemaBounceRequestError(payload.error.message, `a2a_${payload.error.code}`);
  }
  if (payload.result === undefined) {
    throw new SchemaBounceRequestError(`${method} returned no result`, 'a2a_result_missing');
  }
  return payload.result;
}

export async function sendMessage(
  config: SchemaBounceAdapterConfig,
  token: string,
  input: {
    prompt: string;
    paperclipTaskId: string;
    paperclipTaskUrl?: string;
    contextId?: string;
    wakeReason?: string;
    commentId?: string;
    paperclipRunId: string;
  },
  signal?: AbortSignal
): Promise<A2ATask> {
  return rpc<A2ATask>(
    config,
    token,
    'message/send',
    {
      message: {
        role: 'user',
        parts: [{ text: { text: input.prompt } }],
        ...(input.contextId ? { contextId: input.contextId } : {}),
      },
      metadata: {
        externalRef: {
          source: 'paperclip',
          externalId: input.paperclipTaskId,
          ...(input.paperclipTaskUrl ? { url: input.paperclipTaskUrl } : {}),
        },
        paperclipRunId: input.paperclipRunId,
        ...(input.wakeReason ? { wakeReason: input.wakeReason } : {}),
        ...(input.commentId ? { commentId: input.commentId } : {}),
      },
    },
    signal
  );
}

export function getTask(
  config: SchemaBounceAdapterConfig,
  token: string,
  taskId: string,
  signal?: AbortSignal
): Promise<A2ATask> {
  return rpc<A2ATask>(config, token, 'tasks/get', { taskId }, signal);
}

export function listTasks(
  config: SchemaBounceAdapterConfig,
  token: string,
  signal?: AbortSignal
): Promise<unknown> {
  return rpc(config, token, 'tasks/list', { limit: 1 }, signal);
}

export function cancelTask(
  config: SchemaBounceAdapterConfig,
  token: string,
  taskId: string,
  signal?: AbortSignal
): Promise<A2ATask> {
  return rpc<A2ATask>(config, token, 'tasks/cancel', { taskId }, signal);
}

function parseSSEBlock(block: string): A2AStreamEvent | undefined {
  const data = block
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data) return undefined;
  try {
    return JSON.parse(data) as A2AStreamEvent;
  } catch {
    return undefined;
  }
}

export async function streamTask(
  config: SchemaBounceAdapterConfig,
  token: string,
  taskId: string,
  onEvent: (event: A2AStreamEvent) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const url = apiPath(
    config,
    `/api/v1/a2a/${encodeURIComponent(config.workspaceId)}/${encodeURIComponent(
      config.agentId
    )}/tasks/${encodeURIComponent(taskId)}/stream`
  );
  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) throw await errorForResponse(response, 'task stream');
  if (!response.body) {
    throw new SchemaBounceRequestError('Task stream returned no response body', 'stream_body_missing');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + separator.length);
      const event = parseSSEBlock(block);
      if (event) await onEvent(event);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
    if (done) break;
  }
  const trailing = parseSSEBlock(buffer);
  if (trailing) await onEvent(trailing);
}

export async function getAgentCard(
  config: SchemaBounceAdapterConfig,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(
    apiPath(
      config,
      `/api/v1/a2a/${encodeURIComponent(config.workspaceId)}/${encodeURIComponent(
        config.agentId
      )}/agent-card.json`
    ),
    { headers: { Accept: 'application/json' }, signal }
  );
  if (!response.ok) throw await errorForResponse(response, 'agent card request');
  return response.json();
}
