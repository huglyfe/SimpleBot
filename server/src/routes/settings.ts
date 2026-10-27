import { createModels, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { radiusProvider } from '@earendil-works/pi-ai/providers/all';
import { AuthoredValidationError } from '../authored.js';
import { SecretStore } from '../secrets.js';
import {
  secretNameSchema,
  secretWriteSchema,
  secretDeleteSchema,
} from '@simplebot/shared';
import { providerConnection } from '../credentials.js';
/** Root settings, external dependencies, the published catalog, and providers. */

import type {
  PresetList,
  ProviderList,
  ProviderModels,
} from '@simplebot/shared';
import type { FastifyInstance } from 'fastify';
import {
  authoredDocumentWriteSchema,
  REASONING_LEVELS,
} from '@simplebot/shared';
import type { RouteContext } from './context.js';

export function registerSettingsRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const secrets = new SecretStore(ctx.authored.root);
  app.get('/api/secrets', async () => secrets.list());
  app.put('/api/secrets/:name', async (request) => {
    const { name } = request.params as { name: string };
    const body = secretWriteSchema.safeParse(request.body);
    if (!body.success)
      throw new AuthoredValidationError('Invalid secret request');
    return secrets.write(
      secretNameSchema.parse(name),
      body.data.value,
      body.data.expectedRevision,
    );
  });
  app.delete('/api/secrets/:name', async (request) => {
    const { name } = request.params as { name: string };
    const body = secretDeleteSchema.parse(request.body);
    return secrets.write(
      secretNameSchema.parse(name),
      null,
      body.expectedRevision,
    );
  });

  app.get('/api/settings', async () => {
    const config = await ctx.authored.readConfig();
    const {
      mcpServers: _mcp,
      memoryServers: _memory,
      dockerContainers: _docker,
      ...value
    } = config.value;
    return { ...config, value };
  });

  app.put('/api/settings', async (request) => {
    const body = authoredDocumentWriteSchema.parse(request.body);
    const current = await ctx.authored.readConfig();
    const revision = await ctx.authored.writeConfig(
      {
        ...body.value,
        mcpServers: current.value.mcpServers,
        memoryServers: current.value.memoryServers,
        dockerContainers: current.value.dockerContainers,
      },
      body.expectedRevision,
    );
    const timezone = (await ctx.authored.readConfig()).value.application
      .timezone;
    ctx.cron.wake(timezone);
    return { revision };
  });

  app.get('/api/dependencies', async () => ctx.authored.readDependencyConfig());

  app.put('/api/dependencies', async (request) => {
    const body = authoredDocumentWriteSchema.parse(request.body);
    const result = await ctx.authored.writeDependencyConfig(
      body.value,
      body.expectedRevision,
    );
    return { revision: result };
  });

  app.post('/api/capabilities/refresh', async () => {
    await ctx.reloadDependencies();
    return ctx.capabilities().catalog;
  });

  app.get('/api/capabilities', async () => {
    return ctx.capabilities().catalog;
  });

  app.get('/api/presets', async (): Promise<PresetList> => ({
    presets: await ctx.authored.listPresets(),
  }));

  /**
   * The provider list is pi-ai's, so the client picks from what the library
   * actually supports instead of the operator typing a raw provider id.
   */
  app.get('/api/providers', (): ProviderList => ({
    providers: ctx.models.getProviders().map(({ id, name }) => ({ id, name })),
  }));

  /**
   * One provider's models, refreshed on request the way the tool catalog is
   * warmed. A refresh failure is reported alongside the last-known list rather
   * than thrown: a provider outage must not empty the operator's picker.
   */
  app.get('/api/providers/:providerId/models', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const existing = ctx.models.getProvider(providerId);
    if (existing === undefined)
      return reply.code(404).send({ error: `Unknown provider ${providerId}` });
    const { value, revision } = await ctx.authored.readConfig();
    let error: string | null = null;
    try {
      const configured = value.providers[providerId];
      if (configured === undefined)
        throw new Error('Provider is not configured');
      const connection = providerConnection(
        configured,
        providerId,
        ctx.authored.root,
      );
      // Discovery gets the same explicit key as generation, without mutating
      // process.env or persisting a second credential store.
      const credentials = new InMemoryCredentialStore();
      const apiKey = connection.apiKey;
      if (apiKey !== undefined)
        await credentials.modify(providerId, async () => ({
          type: 'api_key',
          key: apiKey,
        }));
      const discovery = createModels({ credentials });
      const provider =
        providerId === 'radius'
          ? radiusProvider(
              connection.baseUrl === undefined
                ? {}
                : { gateway: connection.baseUrl },
            )
          : existing;
      discovery.setProvider(provider);
      if ((await discovery.checkAuth(providerId)) === undefined)
        throw new Error('Provider credentials are unavailable');
      const refreshed = await discovery.refresh({ providers: [providerId] });
      const failure = refreshed.errors.get(providerId);
      if (failure !== undefined) throw failure;
      if ((await ctx.authored.readConfig()).revision !== revision)
        throw new Error(
          'Provider settings changed during discovery; refresh again',
        );
      ctx.models.setProvider(provider);
    } catch (failure) {
      error =
        failure instanceof Error
          ? failure.message
          : 'Provider discovery failed';
    }
    return {
      models: ctx.models.getModels(providerId).map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        reasoningLevels: model.reasoning
          ? REASONING_LEVELS.filter(
              (level) => model.thinkingLevelMap?.[level] !== null,
            )
          : ['off'],
        images: model.input.includes('image'),
        contextWindow: model.contextWindow,
      })),
      error,
    } satisfies ProviderModels;
  });
}
