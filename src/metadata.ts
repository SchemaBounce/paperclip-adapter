import type { AdapterModel } from '@paperclipai/adapter-utils';

export const adapterType = 'schemabounce';
export const adapterLabel = 'SchemaBounce Hosted Agent';
export const adapterModels: AdapterModel[] = [];

export const configurationDoc = `# schemabounce adapter configuration

Use when:
- Paperclip should delegate a heartbeat to a hosted SchemaBounce agent.
- The SchemaBounce service account is scoped to the configured agent.
- Paperclip needs streamed progress, usage, cost, and A2A context continuity.

Required fields:
- apiUrl: SchemaBounce control-plane URL. Use https://api.schemabounce.com in production.
- workspaceId: SchemaBounce workspace ID.
- agentId: SchemaBounce agent ID.
- clientId and clientSecret: credentials for an agent-scoped workspace service account.

Security:
- clientSecret is a managed Paperclip secret. Never place it in prompts, logs, or result metadata.
- Remote endpoints must use HTTPS. Loopback HTTP is accepted for local development.
- Use a service account limited to the selected agent.
`;
