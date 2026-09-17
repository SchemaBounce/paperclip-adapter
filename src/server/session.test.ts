import { describe, expect, it } from 'vitest';
import { sessionCodec } from './session.js';

describe('sessionCodec', () => {
  it('round-trips the A2A context ID', () => {
    const params = { a2aContextId: 'ctx_123' };
    expect(sessionCodec.deserialize(params)).toEqual(params);
    expect(sessionCodec.serialize(params)).toEqual(params);
    expect(sessionCodec.getDisplayId?.(params)).toBe('ctx_123');
  });

  it('drops malformed session data', () => {
    expect(sessionCodec.deserialize({ a2aContextId: '' })).toBeNull();
    expect(sessionCodec.deserialize('ctx_123')).toBeNull();
  });
});
