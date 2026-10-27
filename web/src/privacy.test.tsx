import { webcrypto } from 'node:crypto';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PrivacyGate, PrivacySettings } from './privacy.js';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('unreadable PIN storage never mounts private children', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage denied');
  });
  render(
    <PrivacyGate>
      <p>Private conversation</p>
    </PrivacyGate>,
  );
  expect(screen.queryByText('Private conversation')).not.toBeInTheDocument();
  expect(
    screen.getByRole('dialog', { name: 'SimpleBot is locked' }),
  ).toBeVisible();
});

test('a failed storage write does not claim that a PIN was enabled', async () => {
  const user = userEvent.setup();
  render(
    <PrivacyGate>
      <PrivacySettings />
    </PrivacyGate>,
  );
  await user.click(screen.getByRole('button', { name: 'Set privacy PIN' }));
  await user.type(screen.getByLabelText('New PIN', { exact: true }), '123456');
  await user.type(screen.getByLabelText('Repeat new PIN'), '123456');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage full');
  });
  await user.click(screen.getByRole('button', { name: 'Save privacy PIN' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage full');
  expect(
    screen.queryByRole('button', { name: 'Lock now' }),
  ).not.toBeInTheDocument();
  expect(localStorage.getItem('simplebot:privacy-pin')).toBeNull();
});

test('removing a PIN while backgrounding cannot leave an un-unlockable screen', async () => {
  const user = userEvent.setup();
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  render(
    <PrivacyGate>
      <PrivacySettings />
    </PrivacyGate>,
  );
  await user.click(screen.getByRole('button', { name: 'Set privacy PIN' }));
  await user.type(screen.getByLabelText('New PIN', { exact: true }), '123456');
  await user.type(screen.getByLabelText('Repeat new PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Save privacy PIN' }));
  await screen.findByRole('button', { name: 'Lock now' });
  await user.click(screen.getByRole('button', { name: 'Remove privacy PIN' }));
  await user.type(screen.getByLabelText('Current PIN'), '123456');
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Remove privacy PIN',
    }),
  );
  fireEvent(window, new Event('pagehide'));
  await waitFor(() =>
    expect(localStorage.getItem('simplebot:privacy-pin')).toBeNull(),
  );
  now = 31_000;
  fireEvent(window, new Event('pageshow'));
  expect(
    screen.queryByRole('dialog', { name: 'SimpleBot is locked' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Set privacy PIN' })).toBeVisible();
});
