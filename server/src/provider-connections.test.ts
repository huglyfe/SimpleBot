import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { radiusProvider } from '@earendil-works/pi-ai/providers/all';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { providerModelsResponseSchema } from '@simplebot/shared';
import { SecretStore } from './secrets.js';
import { AuthoredFiles } from './authored.js';
import { assembleAttempt } from './assemble.js';
import { disposeTestFixture, createTestFixture } from './test-helper.js';

test('OpenRouter sends the durable session header through both provider APIs without changing the catalog', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => disposeTestFixture(fixture));
  fixture.models.setProvider(openrouterProvider());
  const authored = new AuthoredFiles(fixture.root);
  const config = await authored.readConfig();
  await authored.writeConfig(
    {
      ...config.value,
      providers: { ...config.value.providers, openrouter: {} },
    },
    config.revision,
  );
  for (const modelId of [
    'google/gemini-3.8-flash',
    'anthropic/claude-sonnet-4.6',
  ]) {
    const preset = await authored.readPresetDocument('default');
    await authored.writePresetDocument(
      'default',
      {
        ...preset.value,
        mainModel: { provider: 'openrouter', model: modelId },
      },
      preset.revision,
    );
    const sessionId = randomUUID();
    const now = new Date();
    fixture.runtime.storage.createSession({
      id: sessionId,
      botSlug: 'echo',
      presetSlug: 'default',
      now: now.toISOString(),
    });
    const admitted = fixture.runtime.storage.admitAttempt({
      sessionId,
      target: { kind: 'reply', source: 'Synthetic affinity test' },
      variantId: randomUUID(),
      now: now.toISOString(),
    });
    for (let request = 0; request < 2; request += 1) {
      const assembly = await assembleAttempt({
        sessionId,
        ...admitted,
        storage: fixture.runtime.storage,
        authored,
        capabilities: fixture.runtime.capabilities,
        models: fixture.models,
        now,
      });
      assert.equal(Object.isFrozen(assembly.streamOptions.headers), true);
      const observed: (string | null)[] = [];
      const stream = fixture.models.streamSimple(
        assembly.model,
        assembly.context,
        {
          ...assembly.streamOptions,
          apiKey: 'synthetic-key',
          fetch: async (_url, init) => {
            observed.push(new Headers(init?.headers).get('x-session-id'));
            return new Response(
              JSON.stringify({
                error: { message: 'Synthetic end of request' },
              }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            );
          },
        },
      );
      for await (const _event of stream) {
        /* Drain the synthetic response. */
      }
      await stream.result();
      assert.deepEqual(observed, [sessionId]);
    }
    assert.equal(
      fixture.models.getModel('openrouter', modelId)?.headers?.['x-session-id'],
      undefined,
    );
  }
});

for (const savedSecret of [false, true]) {
  test(`saved provider references and URLs drive discovery and immutable generation; missing references never fall back (saved secret: ${String(savedSecret)})`, async (t) => {
    const fixture = await createTestFixture();
    t.after(() => disposeTestFixture(fixture));
    fixture.models.setProvider(radiusProvider());
    const requests: string[] = [];
    const gateway = createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.headers.authorization !== 'Bearer synthetic-connection-key') {
        response.writeHead(401).end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          baseUrl: 'http://unused.invalid/provider-default',
          models: [{ ...fixture.faux.getModel(), id: 'connection-test' }],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      gateway.listen(0, '127.0.0.1', resolve),
    );
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          gateway.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const address = gateway.address();
    assert.ok(address !== null && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    t.mock.property(process, 'env', {
      ...process.env,
      SIMPLEBOT_CONNECTION_TEST_KEY: 'synthetic-connection-key',
      RADIUS_API_KEY: 'wrong-ambient-key',
      SIMPLEBOT_MISSING_CONNECTION_KEY: '',
    });
    const authored = new AuthoredFiles(fixture.root);
    const config = await authored.readConfig();
    await authored.writeConfig(
      {
        ...config.value,
        providers: {
          ...config.value.providers,
          radius: {
            apiKey: savedSecret
              ? 'secret:CONNECTION_KEY'
              : '${SIMPLEBOT_CONNECTION_TEST_KEY}',
            baseUrl,
          },
        },
      },
      config.revision,
    );
    const secrets = new SecretStore(fixture.root);
    secrets.write(
      'CONNECTION_KEY',
      'synthetic-connection-key',
      secrets.list().revision,
    );
    const app = fixture.runtime.app;
    const response = await app.inject('/api/providers/radius/models');
    const catalog = providerModelsResponseSchema.parse(response.json());
    assert.equal(catalog.error, null);
    assert.equal(catalog.models[0]?.id, 'connection-test');
    assert.deepEqual(requests, ['/v1/config']);
    assert.equal(response.body.includes('synthetic-connection-key'), false);
    const preset = await authored.readPresetDocument('default');
    await authored.writePresetDocument(
      'default',
      {
        ...preset.value,
        mainModel: { provider: 'radius', model: 'connection-test' },
      },
      preset.revision,
    );
    const now = new Date();
    const session = fixture.runtime.storage.createSession({
      id: randomUUID(),
      botSlug: 'echo',
      presetSlug: 'default',
      now: now.toISOString(),
    });
    const admitted = fixture.runtime.storage.admitAttempt({
      sessionId: session.id,
      target: { kind: 'reply', source: 'Hello' },
      variantId: randomUUID(),
      now: now.toISOString(),
    });
    const assembly = await assembleAttempt({
      sessionId: session.id,
      ...admitted,
      storage: fixture.runtime.storage,
      authored,
      capabilities: fixture.runtime.capabilities,
      models: fixture.models,
      now,
    });
    assert.equal(assembly.model.baseUrl, baseUrl);
    assert.equal(assembly.streamOptions.apiKey, 'synthetic-connection-key');
    secrets.write('CONNECTION_KEY', 'replacement-key', secrets.list().revision);
    const next = await authored.readConfig();
    await authored.writeConfig(
      {
        ...next.value,
        providers: {
          ...next.value.providers,
          radius: { apiKey: '${SIMPLEBOT_MISSING_CONNECTION_KEY}', baseUrl },
        },
      },
      next.revision,
    );
    const failed = providerModelsResponseSchema.parse(
      (await app.inject('/api/providers/radius/models')).json(),
    );
    assert.match(failed.error ?? '', /credential reference is unavailable/u);
    assert.equal(failed.models[0]?.id, 'connection-test');
    assert.equal(requests.length, 1);
    assert.equal(assembly.streamOptions.apiKey, 'synthetic-connection-key');
  });
}
