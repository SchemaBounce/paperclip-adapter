import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from '@paperclipai/adapter-utils';
import { exchangeToken, getAgentCard, listTasks } from './client.js';
import { parseConfig } from './config.js';

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  try {
    const config = parseConfig(ctx.config);
    checks.push({
      code: 'config_valid',
      level: 'info',
      message: 'SchemaBounce adapter configuration is valid.',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      await getAgentCard(config, controller.signal);
      checks.push({
        code: 'agent_card_available',
        level: 'info',
        message: 'The configured SchemaBounce agent is available.',
      });

      const token = await exchangeToken(config, controller.signal);
      checks.push({
        code: 'service_account_authenticated',
        level: 'info',
        message: 'The SchemaBounce service account authenticated successfully.',
      });

      await listTasks(config, token, controller.signal);
      checks.push({
        code: 'agent_scope_verified',
        level: 'info',
        message: 'The service account can access the configured agent.',
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    checks.push({
      code: 'schemabounce_connection_failed',
      level: 'error',
      message: 'Paperclip could not connect to the configured SchemaBounce agent.',
      detail: error instanceof Error ? error.message : String(error),
      hint: 'Check the API URL, agent-scoped service account, workspace ID, and agent ID.',
    });
  }

  return {
    adapterType: ctx.adapterType,
    status: checks.some(check => check.level === 'error') ? 'fail' : 'pass',
    checks,
    testedAt: new Date().toISOString(),
  };
}
