import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterVariables, MAX_VARIABLE_PATTERN_CHARS } from './variables.js';

const variables = {
  Mood: 'bright',
  mood: 'calm',
  mood_history: 'steady',
  trust: 'high',
};

test('variable filtering supports all, exact names, and bounded RE2 patterns', () => {
  assert.equal(filterVariables(variables).length, 4);
  assert.deepEqual(filterVariables(variables, '*'), filterVariables(variables));
  assert.deepEqual(filterVariables(variables, 'mood'), [
    { name: 'mood', value: 'calm' },
  ]);
  assert.deepEqual(filterVariables(variables, 'ood_'), [
    { name: 'mood_history', value: 'steady' },
  ]);
  assert.deepEqual(filterVariables(variables, '^mood'), [
    { name: 'mood', value: 'calm' },
    { name: 'mood_history', value: 'steady' },
  ]);
  assert.deepEqual(filterVariables(variables, '^Mood'), [
    { name: 'Mood', value: 'bright' },
  ]);
  assert.deepEqual(filterVariables(variables, '^absent$'), []);
  assert.throws(
    () => filterVariables(variables, '('),
    /Invalid or unsupported variable pattern/u,
  );
  assert.throws(
    () => filterVariables(variables, '(?=mood)'),
    /Invalid or unsupported variable pattern/u,
  );
  assert.throws(
    () =>
      filterVariables(variables, 'a'.repeat(MAX_VARIABLE_PATTERN_CHARS + 1)),
    /Variable pattern limit of 256 characters exceeded/u,
  );
});
