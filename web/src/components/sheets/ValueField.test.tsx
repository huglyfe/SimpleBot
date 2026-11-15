import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useState } from 'react';
import type { ServerValue } from '@simplebot/shared';
import { ValueField } from './ValueField.js';

function Harness({
  initial,
  plain = false,
  seen,
}: {
  initial: ServerValue;
  plain?: boolean;
  seen: ServerValue[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <ValueField
      label="Key"
      plain={plain}
      value={value}
      onChange={(next) => {
        seen.push(next);
        setValue(next);
      }}
    />
  );
}

it('never shows a saved private value, overwrites on typing, and keeps it when cleared', async () => {
  const seen: ServerValue[] = [];
  const saved = { private: 'a'.repeat(32) };
  render(<Harness initial={saved} seen={seen} />);
  const input = screen.getByLabelText('Key', { exact: true });
  expect(input).toHaveAttribute('type', 'password');
  expect(input).toHaveValue('');
  await userEvent.type(input, 'new');
  expect(seen.at(-1)).toEqual({ value: 'new' });
  await userEvent.clear(input);
  expect(seen.at(-1)).toEqual(saved);
});

it('stores environment variables as exact references and offers plain text only where allowed', async () => {
  const seen: ServerValue[] = [];
  const { unmount } = render(<Harness initial="${OLD}" seen={seen} />);
  expect(screen.getByLabelText('Key source')).toHaveValue('environment');
  expect(
    screen.queryByRole('option', { name: 'Plain text' }),
  ).not.toBeInTheDocument();
  const input = screen.getByLabelText('Key', { exact: true });
  expect(input).toHaveValue('OLD');
  await userEvent.clear(input);
  await userEvent.type(input, 'NEW');
  expect(seen.at(-1)).toBe('${NEW}');
  unmount();

  render(<Harness initial="debug" plain seen={seen} />);
  expect(screen.getByLabelText('Key source')).toHaveValue('plain');
  await userEvent.selectOptions(screen.getByLabelText('Key source'), 'private');
  expect(seen.at(-1)).toEqual({ value: '' });
  await userEvent.type(screen.getByLabelText('Key', { exact: true }), 's');
  expect(seen.at(-1)).toEqual({ value: 's' });
});
