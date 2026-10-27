import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthoredFiles } from './authored.js';
import { assembleAttempt } from './assemble.js';
import { createTestFixture, reopenTestFixture } from './test-helper.js';

test('preset assignment is session-owned, survives restart, and affects only later assemblies', async (t) => {
  const fixture = await createTestFixture();
  t.after(() => fixture.runtime.close());
  const { app, storage } = fixture.runtime;
  // Arrange and change authored files through the same API the picker uses.
  const original = (await app.inject('/api/presets/default')).json<{
    value: Record<string, unknown>;
  }>();
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/presets/alternate',
        payload: {
          value: {
            ...original.value,
            prompts: { system: '', instructions: 'Alternate preset marker' },
          },
          expectedRevision: 'missing',
        },
      })
    ).statusCode,
    200,
  );
  const sessions: string[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { botSlug: 'echo' },
    });
    sessions.push(response.json<{ id: string }>().id);
  }
  const [sessionId, otherSessionId] = sessions;
  assert.ok(sessionId && otherSessionId);
  const target = storage.admitAttempt({
    sessionId,
    target: { kind: 'reply', source: 'Hello' },
    variantId: randomUUID(),
    now: new Date().toISOString(),
  });
  const assemblyInput = {
    sessionId,
    ...target,
    storage,
    authored: new AuthoredFiles(fixture.root),
    capabilities: fixture.runtime.capabilities,
    models: fixture.models,
    now: new Date(),
  };
  const frozen = await assembleAttempt(assemblyInput);
  const before = frozen.context.systemPrompt ?? '';
  const select = (id: string, presetSlug: string) =>
    app.inject({
      method: 'PATCH',
      url: `/api/sessions/${id}/preset`,
      payload: { presetSlug },
    });
  assert.equal((await select(sessionId, 'alternate')).statusCode, 204);
  assert.equal(storage.sessionIdentity(sessionId)?.presetSlug, 'alternate');
  assert.equal(storage.sessionIdentity(otherSessionId)?.presetSlug, 'default');
  assert.equal(frozen.context.systemPrompt ?? '', before);
  const next = await assembleAttempt(assemblyInput);
  assert.match(next.context.systemPrompt ?? '', /Alternate preset marker/);
  assert.equal(storage.projection(sessionId).page.positions.length, 2);
  assert.equal((await select(sessionId, '../invalid')).statusCode, 400);
  assert.equal((await select(sessionId, 'missing')).statusCode, 400);
  assert.equal((await select(randomUUID(), 'alternate')).statusCode, 404);
  assert.equal(storage.sessionIdentity(sessionId)?.presetSlug, 'alternate');
  await fixture.runtime.close();
  const reopened = await reopenTestFixture(fixture);
  t.after(() => reopened.runtime.close());
  assert.equal(
    reopened.runtime.storage.sessionIdentity(sessionId)?.presetSlug,
    'alternate',
  );
});
