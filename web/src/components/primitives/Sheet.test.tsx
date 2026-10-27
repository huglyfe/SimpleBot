import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Sheet, type SheetPlacement } from './Sheet.js';

function Harness({
  open,
  onClose,
  placement,
}: {
  open: boolean;
  onClose: () => void;
  placement?: SheetPlacement;
}) {
  const placed = placement === undefined ? {} : { placement };
  return (
    <>
      <button type="button">opener</button>
      {open ? (
        <Sheet label="Preset" title="Preset" {...placed} onClose={onClose}>
          <input aria-label="Model" />
          <button type="button">Save</button>
        </Sheet>
      ) : null}
    </>
  );
}

function renderSheet(onClose: () => void) {
  return render(<Harness open onClose={onClose} />);
}

describe('Sheet', () => {
  it('is a labelled modal dialog that takes focus on open', () => {
    renderSheet(vi.fn());

    expect(screen.getByRole('dialog', { name: 'Preset' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus();
  });

  it.each([
    ['side', 'Back'],
    ['top', 'Close'],
    ['center', 'Close'],
  ] as [SheetPlacement, string][])(
    'arrives from %s and points its dismiss back that way',
    (placement, tooltip) => {
      render(<Harness open placement={placement} onClose={vi.fn()} />);

      expect(screen.getByRole('dialog', { name: 'Preset' })).toHaveClass(
        `is-${placement}`,
      );
      expect(
        screen.getByRole('button', { name: 'Close panel' }),
      ).toHaveAttribute('title', tooltip);
    },
  );

  it('closes on Escape and on the scrim', async () => {
    const onClose = vi.fn();
    renderSheet(onClose);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'), { clientX: -1, clientY: -1 });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('returns focus when it closes', async () => {
    const onClose = vi.fn();
    // Focus must be on the opener before the sheet mounts — the sheet captures
    // what to restore at mount time, not at close time.
    const { rerender } = render(<Harness open={false} onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    rerender(<Harness open onClose={onClose} />);

    rerender(<Harness open={false} onClose={onClose} />);
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
