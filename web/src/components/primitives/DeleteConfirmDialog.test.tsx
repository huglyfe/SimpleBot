import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DeleteConfirmDialog } from './DeleteConfirmDialog.js';

it('wires deletion to close only after success and cancellation to close without deleting', async () => {
  const pending = Promise.withResolvers<undefined>();
  const onDelete = vi.fn(() => pending.promise);
  const onClose = vi.fn();
  render(
    <DeleteConfirmDialog
      title="Delete record?"
      body="Only this record."
      onDelete={onDelete}
      onClose={onClose}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onDelete).not.toHaveBeenCalled();
  onClose.mockClear();
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => pending.resolve(undefined));
  expect(onClose).toHaveBeenCalledTimes(1);
});
