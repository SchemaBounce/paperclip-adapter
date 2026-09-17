import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSchemaBounceModels } from './models.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SCHEMABOUNCE_API_URL;
});

describe('fetchSchemaBounceModels', () => {
  it('reads the public /api/v1/llm/models catalog and flattens providers into AdapterModel entries', async () => {
    process.env.SCHEMABOUNCE_API_URL = 'http://127.0.0.1:30080';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        providers: [
          {
            provider: 'anthropic',
            displayName: 'Anthropic',
            defaultModel: 'claude-sonnet',
            models: ['claude-sonnet', 'claude-haiku'],
            source: 'live',
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchSchemaBounceModels();

    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://127.0.0.1:30080/api/v1/llm/models');
    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet', label: 'claude-sonnet (Anthropic)' },
      { id: 'anthropic/claude-haiku', label: 'claude-haiku (Anthropic)' },
    ]);
  });

  it('defaults to the production API URL when SCHEMABOUNCE_API_URL is unset', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ providers: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSchemaBounceModels();

    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.schemabounce.com/api/v1/llm/models');
  });

  it('returns an empty list on a non-2xx response instead of throwing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSchemaBounceModels()).resolves.toEqual([]);
  });

  it('returns an empty list when fetch rejects', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSchemaBounceModels()).resolves.toEqual([]);
  });
});
