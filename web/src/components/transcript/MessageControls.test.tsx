import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MessageControls } from './MessageControls.js';

it('awaits swipe deletion and retains the confirmation on failure', async () => {
  const pending = Promise.withResolvers<undefined>();
  const remove = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <MessageControls
      role="assistant"
      createdAt="2026-09-26T12:00:00Z"
      copied={false}
      busy={false}
      onCopy={vi.fn()}
      onEdit={vi.fn()}
      swipe={{
        index: 1,
        count: 2,
        onPrevious: vi.fn(),
        onNext: vi.fn(),
        onGenerate: vi.fn(),
        onDelete: remove,
      }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Delete swipe' }));
  const dialog = screen.getByRole('alertdialog');
  await user.click(
    within(dialog).getByRole('button', { name: 'Delete swipe' }),
  );
  expect(
    within(dialog).getByRole('button', { name: 'Deleting…' }),
  ).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await act(async () => pending.reject(new Error('Deletion refused')));
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Deletion refused',
  );
  await user.click(
    within(dialog).getByRole('button', { name: 'Delete swipe' }),
  );
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(remove).toHaveBeenCalledTimes(2);
});
