import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from '../primitives/Sheet.js';
import { RecordEditor, TextRecord } from './RecordEditor.js';

function Harness({
  onSave = () => undefined,
}: {
  onSave?: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState('Original');
  return (
    <Sheet title="Owner" label="Owner" onClose={() => undefined}>
      <ul className="record-list">
        <TextRecord
          title="Summary"
          value={value}
          onSave={async (next) => {
            await onSave(next);
            setValue(next);
          }}
        />
      </ul>
    </Sheet>
  );
}

describe('RecordEditor', () => {
  it('contains the draft, saves once, and restores the owner and focus', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<Harness onSave={save} />);
    const opener = screen.getByRole('button', { name: 'Edit Summary' });
    const owner = screen.getByRole('dialog', { name: 'Owner' });
    await user.click(opener);
    expect(owner).toHaveAttribute('open');
    await user.type(
      screen.getByRole('textbox', { name: 'Summary' }),
      ' edited',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('Original edited');
    expect(owner).toHaveAttribute('open');
    expect(opener).toHaveFocus();
  });

  it('discards only the child draft', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(<Harness onSave={save} />);
    await user.click(screen.getByRole('button', { name: 'Edit Summary' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Summary' }),
      ' abandoned',
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Edit Summary' })).getByRole(
        'button',
        { name: 'Discard' },
      ),
    );
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Edit Summary' }));
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue(
      'Original',
    );
  });

  it('holds a pending save and preserves the draft on failure without another call', async () => {
    const user = userEvent.setup();
    const result = Promise.withResolvers<undefined>();
    const save = vi.fn(() => result.promise);
    render(<Harness onSave={save} />);
    await user.click(screen.getByRole('button', { name: 'Edit Summary' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Summary' }),
      ' edited',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.keyboard('{Escape}');
    expect(
      screen.getByRole('dialog', { name: 'Edit Summary' }),
    ).toBeInTheDocument();
    await act(async () => result.reject(new Error('Write refused')));
    expect(screen.getByRole('alert')).toHaveTextContent('Write refused');
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue(
      'Original edited',
    );
    expect(save).toHaveBeenCalledTimes(1);
  });
});

it('confirms removal and returns focus to the collection', async () => {
  const user = userEvent.setup();
  function Collection() {
    const [exists, setExists] = useState(true);
    return (
      <ul>
        {exists ? (
          <RecordEditor
            title="Provider"
            value="saved"
            onSave={vi.fn()}
            remove={{
              label: 'Remove provider',
              onClick: () => setExists(false),
            }}
          >
            {() => <input aria-label="Key" />}
          </RecordEditor>
        ) : null}
        <li>
          <button>Add provider</button>
        </li>
      </ul>
    );
  }
  render(<Collection />);
  await user.click(screen.getByRole('button', { name: 'Remove provider' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit Provider' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add provider' })).toHaveFocus();
});
