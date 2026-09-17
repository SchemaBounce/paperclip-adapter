import type { AdapterModel, ServerAdapterModule } from '@paperclipai/adapter-utils';
import { createServerAdapter as createAdapter } from './server/index.js';
import { fetchSchemaBounceModels } from './server/models.js';
import {
  adapterLabel,
  adapterModels,
  adapterType,
  configurationDoc,
} from './metadata.js';

export const type = adapterType;
export const label = adapterLabel;
export const models: AdapterModel[] = adapterModels;
export const agentConfigurationDoc = configurationDoc;

export function createServerAdapter(): ServerAdapterModule {
  return createAdapter();
}

export async function listModels(): Promise<AdapterModel[]> {
  return fetchSchemaBounceModels();
}

export const refreshModels = listModels;
