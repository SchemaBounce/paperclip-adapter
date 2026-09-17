export interface SchemaBounceAdapterConfig {
  apiUrl: URL;
  workspaceId: string;
  agentId: string;
  clientId: string;
  clientSecret: string;
  timeoutSec: number;
}

function requiredString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

export function parseConfig(config: Record<string, unknown>): SchemaBounceAdapterConfig {
  const apiUrlValue = requiredString(config, 'apiUrl');
  let apiUrl: URL;
  try {
    apiUrl = new URL(apiUrlValue);
  } catch {
    throw new Error('apiUrl must be a valid URL');
  }
  if (apiUrl.protocol !== 'https:' && !(apiUrl.protocol === 'http:' && isLoopback(apiUrl.hostname))) {
    throw new Error('apiUrl must use HTTPS, except for loopback local development');
  }
  apiUrl.pathname = apiUrl.pathname.replace(/\/+$/, '');
  apiUrl.search = '';
  apiUrl.hash = '';

  const timeoutValue = Number(config.timeoutSec ?? 900);
  if (!Number.isFinite(timeoutValue) || timeoutValue < 30 || timeoutValue > 7200) {
    throw new Error('timeoutSec must be between 30 and 7200');
  }

  return {
    apiUrl,
    workspaceId: requiredString(config, 'workspaceId'),
    agentId: requiredString(config, 'agentId'),
    clientId: requiredString(config, 'clientId'),
    clientSecret: requiredString(config, 'clientSecret'),
    timeoutSec: Math.floor(timeoutValue),
  };
}

export function apiPath(config: SchemaBounceAdapterConfig, path: string): URL {
  const base = config.apiUrl.toString().replace(/\/+$/, '');
  return new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
}
