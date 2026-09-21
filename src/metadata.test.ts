import { describe, expect, it } from 'vitest';
import { adapterLabel, adapterModels, adapterType, configurationDoc } from './metadata.js';

describe('metadata', () => {
  it('declares the schemabounce adapter type and label', () => {
    expect(adapterType).toBe('schemabounce');
    expect(adapterLabel).toBe('SchemaBounce Hosted Agent');
  });

  it('starts with no static models (models come from the live catalog only)', () => {
    expect(adapterModels).toEqual([]);
  });

  it('documents every required config field and never repeats the secret value', () => {
    for (const field of ['apiUrl', 'workspaceId', 'agentId', 'clientId', 'clientSecret']) {
      expect(configurationDoc).toContain(field);
    }
    expect(configurationDoc.toLowerCase()).toContain('never place it in prompts, logs');
  });
});
