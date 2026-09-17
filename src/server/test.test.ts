import type { AdapterEnvironmentTestContext } from '@paperclipai/adapter-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testEnvironment } from './test.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx(overrides: Partial<AdapterEnvironmentTestContext['config']> = {}): AdapterEnvironmentTestContext {
  return {
    companyId: 'paperclip-company-1',
    adapterType: 'schemabounce',
    config: {
      apiUrl: 'https://api.schemabounce.com',
      workspaceId: 'ws_123',
      agentId: 'agent_123',
      clientId: 'client_123',
      clientSecret: 'super-secret-value',
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('testEnvironment', () => {
  it('passes when the agent card, token exchange, and tasks/list all succeed', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ name: 'Hosted Worker' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 'rpc-1', result: { tasks: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testEnvironment(ctx());

    expect(result.status).toBe('pass');
    expect(result.checks.map(check => check.code)).toEqual([
      'config_valid',
      'agent_card_available',
      'service_account_authenticated',
      'agent_scope_verified',
    ]);
    expect(result.checks.every(check => check.level === 'info')).toBe(true);
  });

  it('fails with a config_valid check when the config is invalid, without any HTTP call', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const result = await testEnvironment(ctx({ apiUrl: 'not-a-url' }));

    expect(result.status).toBe('fail');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ code: 'schemabounce_connection_failed', level: 'error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the agent card request errors, and never logs the client secret', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testEnvironment(ctx());

    expect(result.status).toBe('fail');
    const failing = result.checks.find(check => check.level === 'error');
    expect(failing?.code).toBe('schemabounce_connection_failed');
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });
});
