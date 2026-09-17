import type { AdapterSessionManagement, ServerAdapterModule } from '@paperclipai/adapter-utils';
import {
  adapterModels,
  adapterType,
  configurationDoc,
} from '../metadata.js';
import { getConfigSchema } from './config-schema.js';
import { execute } from './execute.js';
import { fetchSchemaBounceModels } from './models.js';
import { sessionCodec } from './session.js';
import { testEnvironment } from './test.js';

const sessionManagement: AdapterSessionManagement = {
  supportsSessionResume: true,
  nativeContextManagement: 'confirmed',
  defaultSessionCompaction: {
    enabled: false,
    maxSessionRuns: 0,
    maxRawInputTokens: 0,
    maxSessionAgeHours: 0,
  },
};

export function createServerAdapter(): ServerAdapterModule {
  return {
    type: adapterType,
    execute,
    testEnvironment,
    sessionCodec,
    sessionManagement,
    models: adapterModels,
    listModels: fetchSchemaBounceModels,
    refreshModels: fetchSchemaBounceModels,
    agentConfigurationDoc: configurationDoc,
    getConfigSchema,
    supportsLocalAgentJwt: false,
    supportsInstructionsBundle: false,
    requiresMaterializedRuntimeSkills: false,
  };
}

export { execute, getConfigSchema, sessionCodec, testEnvironment };
