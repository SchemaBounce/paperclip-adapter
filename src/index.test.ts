import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerAdapter, label, listModels, models, refreshModels, type as adapterType } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('package root exports', () => {
  it('exposes type, label, and models as required by the external-adapter contract', () => {
    expect(adapterType).toBe('schemabounce');
    expect(label).toBe('SchemaBounce Hosted Agent');
    expect(models).toEqual([]);
  });

  it('createServerAdapter builds a module of the same type', () => {
    expect(createServerAdapter().type).toBe('schemabounce');
  });

  it('listModels and refreshModels both hit the live catalog', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ providers: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listModels()).resolves.toEqual([]);
    await expect(refreshModels()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
