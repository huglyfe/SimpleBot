import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatTodoDue,
  todoCreateSchema,
  todoUpdateSchema,
} from '../src/todos.js';
import { formatClockTime } from '../src/time.js';

void test('deadlines are absent or complete local date-times at minute precision', () => {
  assert.equal(todoCreateSchema.parse({ title: 'Goal' }).due, null);
  for (const due of [null, '2028-02-29T00:00', '2026-10-22T15:45']) {
    assert.equal(todoCreateSchema.parse({ title: 'Goal', due }).due, due);
  }
  for (const due of [
    '2026-02-29T12:00',
    '2026-10-22',
    '15:45',
    '2026-10-22T24:00',
    '2026-10-22T12:60',
    '2026-10-22T15:45Z',
    '2026-10-22T15:45:00',
    '2026-10-22T15:45-04:00',
  ]) {
    assert.equal(
      todoCreateSchema.safeParse({ title: 'Goal', due }).success,
      false,
      due,
    );
  }
  const id = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(todoUpdateSchema.parse({ id, title: 'Changed' }), {
    id,
    title: 'Changed',
  });
  assert.deepEqual(todoUpdateSchema.parse({ id, due: null }), {
    id,
    due: null,
  });
});

void test('deadlines compare local clock time across midnight, leap days, and DST', () => {
  for (const [due, now, expected] of [
    ['2026-10-22T00:00', '2026-10-22T03:59:00Z', 'due tomorrow'],
    ['2026-10-22T00:00', '2026-10-22T04:01:00Z', 'overdue'],
    ['2026-10-22T15:45', '2026-10-22T19:44:00Z', 'due today'],
    ['2026-10-22T15:45', '2026-10-22T19:46:00Z', 'overdue'],
    ['2026-03-08T02:30', '2026-03-08T06:59:00Z', 'due today'],
    ['2026-03-08T02:30', '2026-03-08T07:00:00Z', 'overdue'],
    ['2026-03-08T00:00', '2026-03-09T04:00:00Z', '1 day overdue'],
    ['2026-11-01T00:00', '2026-11-03T05:00:00Z', '2 days overdue'],
    ['2028-03-01T00:00', '2028-02-28T12:00:00Z', 'due in 2 days'],
  ]) {
    assert.ok(due && now && expected);
    assert.equal(
      formatTodoDue(due, 'America/New_York', new Date(now)),
      `${due.replace('T', ' ')} (${expected})`,
    );
  }
  assert.equal(formatTodoDue(null, 'UTC', new Date()), 'No deadline');
});

void test('clock formats agree for deadlines and instants, including midnight and noon', () => {
  for (const [time, twelve] of [
    ['00:00', '12:00 AM'],
    ['12:00', '12:00 PM'],
    ['15:45', '03:45 PM'],
  ]) {
    assert.ok(time && twelve);
    const instant = new Date(`2026-10-22T${time}Z`);
    assert.equal(formatClockTime(instant, 'UTC', '24'), time);
    assert.equal(formatClockTime(instant, 'UTC', '12'), twelve);
    assert.match(
      formatTodoDue(`2026-10-22T${time}`, 'UTC', instant, '12'),
      new RegExp(twelve),
    );
  }
  assert.equal(
    formatClockTime(new Date('2026-10-22T19:45Z'), 'America/New_York', '12'),
    '03:45 PM',
  );
});
