import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog.js';

function Confirmation({ onDelete }: { onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Remove record</button>
      {open ? (
        <ConfirmDialog
          title="Delete record?"
          body={<input aria-label="Reason" />}
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          destructive
          onConfirm={async () => {
            await onDelete();
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe('ConfirmDialog', () => {
  it('submits once, blocks dismissal while pending, and closes only after success', async () => {
    const user = userEvent.setup();
    const deletion = Promise.withResolvers<undefined>();
    const onDelete = vi.fn(() => deletion.promise);
    render(<Confirmation onDelete={onDelete} />);
    const opener = screen.getByRole('button', { name: 'Remove record' });
    await user.click(opener);
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    await user.dblClick(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Reason')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();
    await act(async () => deletion.resolve(undefined));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('retains failures without retrying, and clears them on a new explicit submission', async () => {
    const user = userEvent.setup();
    const deletion = Promise.withResolvers<undefined>();
    const onDelete = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Record is in use'))
      .mockImplementationOnce(() => deletion.promise);
    render(<Confirmation onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Remove record' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Record is in use',
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(onDelete).toHaveBeenCalledTimes(2);
    await act(async () => deletion.resolve(undefined));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels without deleting and forgets an old error when reopened', async () => {
    const user = userEvent.setup();
    const onDelete = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('Refused'));
    render(<Confirmation onDelete={onDelete} />);
    const opener = screen.getByRole('button', { name: 'Remove record' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onDelete).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Refused');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(opener);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
  // Confirmation fields must not join the authored form that opened them.
  it('keeps confirmation fields outside the owning form', () => {
    render(
      <form>
        <ConfirmDialog
          title="Create preset"
          body={<p>Name it.</p>}
          confirmLabel="Create"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </form>,
    );

    expect(screen.getByRole('alertdialog').closest('form')).toBeNull();
  });
});
