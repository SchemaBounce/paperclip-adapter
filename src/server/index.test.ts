import { describe, expect, it } from 'vitest';
import { createServerAdapter } from './index.js';

describe('createServerAdapter', () => {
  it('returns a ServerAdapterModule wired to the schemabounce adapter type', () => {
    const adapter = createServerAdapter();

    expect(adapter.type).toBe('schemabounce');
    expect(typeof adapter.execute).toBe('function');
    expect(typeof adapter.testEnvironment).toBe('function');
    expect(typeof adapter.getConfigSchema).toBe('function');
    expect(adapter.sessionCodec).toBeDefined();
    expect(adapter.sessionManagement).toMatchObject({
      supportsSessionResume: true,
      nativeContextManagement: 'confirmed',
    });
    expect(adapter.supportsLocalAgentJwt).toBe(false);
    expect(adapter.supportsInstructionsBundle).toBe(false);
    expect(adapter.requiresMaterializedRuntimeSkills).toBe(false);
    expect(adapter.agentConfigurationDoc).toContain('schemabounce adapter configuration');
  });
});
