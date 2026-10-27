import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTodoDue, todoCreateSchema } from '../src/todos.js';

void test('due dates use local calendar days across midnight, leap days, and DST', () => {
  for (const [due, now, expected] of [
    ['2026-10-22', '2026-10-22T03:59:00Z', 'due tomorrow'],
    ['2026-10-22', '2026-10-22T04:00:00Z', 'due today'],
    ['2026-03-08', '2026-03-09T04:00:00Z', '1 day overdue'],
    ['2026-11-01', '2026-11-03T05:00:00Z', '2 days overdue'],
    ['2028-03-01', '2028-02-28T12:00:00Z', 'due in 2 days'],
  ]) {
    assert.ok(due && now && expected);
    assert.equal(
      formatTodoDue(due, 'America/New_York', new Date(now)),
      `${due} (${expected})`,
    );
  }
  assert.equal(formatTodoDue(null, 'UTC', new Date()), 'No due date');
  assert.equal(
    todoCreateSchema.safeParse({ title: 'Goal', dueDate: '2026-02-29' })
      .success,
    false,
  );
  assert.equal(
    todoCreateSchema.safeParse({ title: 'Goal', dueDate: '2028-02-29' })
      .success,
    true,
  );
});
