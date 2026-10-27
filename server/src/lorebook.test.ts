import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLorebook } from './memory/lorebook.js';

test('SillyTavern exports load directly without rewriting the source', () => {
  const book = {
    name: 'Example world',
    entries: {
      '0': {
        uid: 0,
        key: ['harbor', 'old port', '', '  '],
        keysecondary: ['night'],
        comment: 'Harbor description',
        content: 'The harbor closes at dusk.',
        disable: false,
        constant: false,
        selective: true,
        order: 100,
        position: 0,
        extensions: { future: true },
      },
      '1': { key: ['harbor'], content: 'Disabled lore', disable: true },
      '2': { key: [], content: 'An entry with no keys' },
    },
  };
  const original = structuredClone(book);
  assert.deepEqual(parseLorebook(book), [
    { keys: ['harbor', 'old port'], content: 'The harbor closes at dusk.' },
    { keys: [], content: 'An entry with no keys' },
  ]);
  assert.deepEqual(book, original);
  assert.deepEqual(parseLorebook({ entries: {} }), []);
});

test('the small example format remains an explicitly supported input', () => {
  const entries = [{ keys: ['harbor'], content: 'The harbor closes at dusk.' }];
  assert.deepEqual(parseLorebook(entries), entries);
  assert.deepEqual(parseLorebook([]), []);
});

test('malformed lorebooks fail instead of becoming empty recall', () => {
  for (const value of [
    null,
    {},
    { entries: [] },
    { entries: { '0': { key: 'harbor', content: 'lore' } } },
    { entries: { '0': { key: ['harbor'], content: 12 } } },
    {
      entries: { '0': { key: ['harbor'], content: 'lore', disable: 'false' } },
    },
    [{ keys: [''], content: 'lore' }],
  ]) {
    assert.throws(() => parseLorebook(value));
  }
});
