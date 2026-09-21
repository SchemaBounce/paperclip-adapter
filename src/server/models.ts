import type { AdapterModel } from '@paperclipai/adapter-utils';

interface ProviderModels {
  provider: string;
  displayName: string;
  models: string[];
}

export async function fetchSchemaBounceModels(): Promise<AdapterModel[]> {
  const base = (process.env.SCHEMABOUNCE_API_URL ?? 'https://api.schemabounce.com').replace(
    /\/+$/,
    ''
  );
  try {
    const response = await fetch(`${base}/api/v1/llm/models`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { providers?: ProviderModels[] };
    return (payload.providers ?? []).flatMap(provider =>
      provider.models.map(model => ({
        id: `${provider.provider}/${model}`,
        label: `${model} (${provider.displayName})`,
      }))
    );
  } catch {
    return [];
  }
}
