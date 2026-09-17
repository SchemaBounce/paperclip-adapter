import type { AdapterConfigSchema } from '@paperclipai/adapter-utils';

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: 'apiUrl',
        label: 'SchemaBounce API URL',
        type: 'text',
        required: true,
        default: 'https://api.schemabounce.com',
        hint: 'Use the control-plane URL. Loopback HTTP is accepted for local development.',
      },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        type: 'text',
        required: true,
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        type: 'text',
        required: true,
        hint: 'Must match the agent restriction on the service account.',
      },
      {
        key: 'clientId',
        label: 'Service account client ID',
        type: 'text',
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Service account client secret',
        type: 'text',
        required: true,
        hint: 'Stored as a managed Paperclip secret reference.',
        meta: { secret: true },
      },
      {
        key: 'timeoutSec',
        label: 'Timeout seconds',
        type: 'number',
        default: 900,
        hint: 'Allowed range: 30 to 7200 seconds.',
      },
    ],
  };
}
