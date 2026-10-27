import assert from 'node:assert/strict';
import test from 'node:test';
import { botDocumentSchema, botGreetings, cardSchema } from '../src/bots.js';

void test('editable cards validate without adding defaults or discarding extensions', () => {
  const value = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: 'Ada',
      extensions: { foreign: { preserved: true } },
    },
  };
  const source = botDocumentSchema.parse({ value, revision: 'one' }).value;
  assert.deepEqual(source, value);
  assert.equal(Object.hasOwn(source.data, 'first_mes'), false);
  assert.deepEqual(botGreetings(source), []);
  assert.equal(cardSchema.parse(source).data.first_mes, '');
  assert.equal(
    botDocumentSchema.safeParse({
      value: { ...value, data: { name: 3 } },
      revision: 'one',
    }).success,
    false,
  );
  assert.deepEqual(
    botGreetings({
      ...source,
      data: {
        ...source.data,
        first_mes: '',
        alternate_greetings: ['Hello', ''],
      },
    }),
    ['', 'Hello', ''],
  );
});
