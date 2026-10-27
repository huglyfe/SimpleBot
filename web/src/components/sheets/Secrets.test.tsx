import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { useState } from 'react';
import { CredentialField, SecretsSection } from './Secrets.js';

const api = vi.hoisted(() => ({
  getSecrets: vi.fn(),
  saveSecret: vi.fn(),
  removeSecret: vi.fn(),
}));
vi.mock('../../api.js', () => api);

it('saves a password once, caches only metadata, selects a reference, and clears the editor on close', async () => {
  api.getSecrets.mockResolvedValue({ names: [], revision: 'one' });
  api.saveSecret.mockResolvedValue({ names: ['KEY'], revision: 'two' });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Connection() {
    const [value, setValue] = useState('');
    return (
      <CredentialField
        label="API key reference"
        value={value}
        onChange={setValue}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <SecretsSection />
      <Connection />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add secret' }),
  );
  const editor = screen.getByRole('dialog', { name: 'Add secret' });
  await userEvent.type(within(editor).getByLabelText('Secret name'), 'KEY');
  const input = within(editor).getByLabelText('Secret value');
  expect(input).toHaveAttribute('type', 'password');
  await userEvent.type(input, 'synthetic-secret');
  await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.saveSecret).toHaveBeenCalledWith(
      'KEY',
      'synthetic-secret',
      'one',
    ),
  );
  await waitFor(() =>
    expect(screen.queryByLabelText('Secret value')).not.toBeInTheDocument(),
  );
  expect(client.getQueryData(['secrets'])).toEqual({
    names: ['KEY'],
    revision: 'two',
  });
  await userEvent.selectOptions(
    screen.getByLabelText('API key reference source'),
    'saved',
  );
  await userEvent.selectOptions(
    screen.getByLabelText('API key reference', { exact: true }),
    'secret:KEY',
  );
  expect(
    screen.getByLabelText('API key reference', { exact: true }),
  ).toHaveValue('secret:KEY');
  await userEvent.click(
    screen.getByRole('button', { name: 'Replace secret KEY' }),
  );
  expect(screen.getByLabelText('Secret value')).toHaveValue('');
  await userEvent.type(screen.getByLabelText('Secret value'), 'discard-me');
  await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Replace secret KEY' }),
  );
  expect(screen.getByLabelText('Secret value')).toHaveValue('');
  expect(api.saveSecret).toHaveBeenCalledTimes(1);
});
