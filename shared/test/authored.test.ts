import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APPLICATION_DEFAULTS,
  dependencyDocumentSchema,
  presetDocumentSchema,
  settingsDocumentSchema,
} from '../src/authored.js';

void test('settings documents normalize defaults and exclude dependency ownership', () => {
  const document = {
    value: { application: {}, providers: {} },
    revision: 'one',
  };
  const parsed = settingsDocumentSchema.parse(document);
  assert.deepEqual(parsed.value.application, APPLICATION_DEFAULTS);
  assert.equal(parsed.value.tts, null);
  assert.equal(parsed.value.application.browserLoginExpiryDays, 30);
  assert.equal('defaultPreset' in parsed.value.application, false);
  assert.equal(
    settingsDocumentSchema.safeParse({
      ...document,
      value: { ...document.value, application: { defaultPreset: 'default' } },
    }).success,
    false,
  );
  for (const [days, valid] of [
    [0, true],
    [1, true],
    [-1, false],
    [0.5, false],
    [36501, false],
  ] as const) {
    assert.equal(
      settingsDocumentSchema.safeParse({
        ...document,
        value: {
          ...document.value,
          application: { browserLoginExpiryDays: days },
        },
      }).success,
      valid,
    );
  }
  assert.equal(
    settingsDocumentSchema.safeParse({
      ...document,
      value: { ...document.value, mcpServers: {} },
    }).success,
    false,
  );
  assert.equal(
    settingsDocumentSchema.safeParse({
      ...document,
      value: {
        ...document.value,
        providers: { example: { apiKey: 'literal-secret' } },
      },
    }).success,
    false,
  );
});

void test('dependency documents retain exact transport roles and reject name collisions', () => {
  const server = { type: 'stdio', command: 'memory-server' };
  const value = { memoryServers: { memory: server } };
  const parsed = dependencyDocumentSchema.parse({ value, revision: 'one' });
  assert.deepEqual(parsed.value.memoryServers.memory, {
    ...server,
    args: [],
    env: {},
  });
  assert.deepEqual(parsed.value.mcpServers, {});
  assert.equal(
    dependencyDocumentSchema.safeParse({
      value: { ...value, mcpServers: { memory: server } },
      revision: 'one',
    }).success,
    false,
  );
});

void test('preset documents supply the same authored defaults to clients', () => {
  const document = {
    revision: 'one',
    value: {
      persona: { name: 'User', description: '' },
      mainModel: { provider: 'example', model: 'chat' },
      prompts: { system: '', instructions: '' },
    },
  };
  const parsed = presetDocumentSchema.parse(document);
  assert.equal(parsed.value.useMainModelForSummary, true);
  assert.equal(parsed.value.summaryModel, null);
  assert.equal(parsed.value.context.liveTailExchanges, 10);
  assert.equal(parsed.value.prompts.postHistory, '');
  for (const summaryModel of [undefined, null]) {
    assert.equal(
      presetDocumentSchema.safeParse({
        ...document,
        value: {
          ...document.value,
          useMainModelForSummary: false,
          summaryModel,
        },
      }).success,
      false,
    );
  }
  assert.equal(
    presetDocumentSchema.safeParse({
      ...document,
      value: {
        ...document.value,
        useMainModelForSummary: false,
        summaryModel: document.value.mainModel,
      },
    }).success,
    true,
  );
  assert.equal(
    presetDocumentSchema.safeParse({
      ...document,
      value: { ...document.value, mainModel: null },
    }).success,
    false,
  );
});
