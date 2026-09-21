import { describe, expect, it } from 'vitest';
import { getConfigSchema } from './config-schema.js';

describe('getConfigSchema', () => {
  it('declares every required config field and marks the secret as meta.secret', () => {
    const schema = getConfigSchema();
    const keys = schema.fields.map(field => field.key);
    expect(keys).toEqual(['apiUrl', 'workspaceId', 'agentId', 'clientId', 'clientSecret', 'timeoutSec']);

    const secretField = schema.fields.find(field => field.key === 'clientSecret');
    expect(secretField?.meta).toEqual({ secret: true });

    for (const key of ['apiUrl', 'workspaceId', 'agentId', 'clientId', 'clientSecret']) {
      const field = schema.fields.find(f => f.key === key);
      expect(field?.required).toBe(true);
    }

    const timeoutField = schema.fields.find(field => field.key === 'timeoutSec');
    expect(timeoutField?.required).toBeFalsy();
    expect(timeoutField?.default).toBe(900);
  });
});
