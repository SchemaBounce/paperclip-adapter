import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

const valid = {
  apiUrl: 'https://api.schemabounce.com/',
  workspaceId: 'ws_123',
  agentId: 'agent_123',
  clientId: 'client_123',
  clientSecret: 'secret',
};

describe('parseConfig', () => {
  it('normalizes a production API URL', () => {
    const config = parseConfig(valid);
    expect(config.apiUrl.toString()).toBe('https://api.schemabounce.com/');
    expect(config.timeoutSec).toBe(900);
  });

  it('accepts loopback HTTP for local development', () => {
    expect(parseConfig({ ...valid, apiUrl: 'http://127.0.0.1:30080' }).apiUrl.port).toBe(
      '30080'
    );
  });

  it('rejects non-loopback HTTP', () => {
    expect(() => parseConfig({ ...valid, apiUrl: 'http://example.com' })).toThrow(/HTTPS/);
  });
});
