import type { AdapterSessionCodec } from '@paperclipai/adapter-utils';

function parse(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const contextId = (raw as Record<string, unknown>).a2aContextId;
  return typeof contextId === 'string' && contextId.trim()
    ? { a2aContextId: contextId.trim() }
    : null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize: parse,
  serialize: parse,
  getDisplayId(params) {
    const parsed = parse(params);
    return typeof parsed?.a2aContextId === 'string' ? parsed.a2aContextId : null;
  },
};
