import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RequestError } from '../../api.js';
import { Sheet } from '../primitives/Sheet.js';
import { AuthoredForm } from './AuthoredForm.js';
import { useAuthoredEditor, type AuthoredSource } from './useAuthoredEditor.js';

type Document = AuthoredSource<{ name: string }>;
const original: Document = { value: { name: 'Original' }, revision: 'rev-1' };

function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const read = vi.fn<() => Promise<Document>>().mockResolvedValue(original);
  const save = vi
    .fn<(value: Document['value'], revision: string) => Promise<Document>>()
    .mockImplementation(async (value) => ({ value, revision: 'rev-2' }));
  function Editor() {
    const query = useQuery({
      queryKey: ['document'],
      queryFn: read,
      initialData: original,
      staleTime: Infinity,
    });
    const editor = useAuthoredEditor({ query, save });
    return (
      <Sheet label="Document" title="Document" onClose={() => undefined}>
        <AuthoredForm {...editor} onSave={editor.update}>
          <input
            aria-label="Name"
            required
            value={editor.value.name}
            onChange={(event) => editor.change({ name: event.target.value })}
          />
        </AuthoredForm>
      </Sheet>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Editor />
    </QueryClientProvider>,
  );
  return {
    client,
    read,
    save,
    user: userEvent.setup(),
    name: screen.getByLabelText('Name'),
  };
}

it('keeps one draft and revision across background reads, then adopts the successful write', async () => {
  const { client, save, user, name } = fixture();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await user.clear(name);
  await user.type(name, 'Local');
  await act(async () => {
    client.setQueryData(['document'], {
      value: { name: 'External' },
      revision: 'external',
    });
  });
  expect(name).toHaveValue('Local');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'Local' }, 'rev-1');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
  );
  await user.type(name, '!');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenLastCalledWith({ name: 'Local!' }, 'rev-2');
});

it('holds a pending write, retains a failed draft, and discards to the saved snapshot', async () => {
  const { save, user, name } = fixture();
  const pending = Promise.withResolvers<Document>();
  save.mockReturnValueOnce(pending.promise);
  await user.type(name, ' edited');
  await user.dblClick(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(name.closest('fieldset')).toHaveAttribute('inert');
  expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  await act(async () => pending.reject(new Error('Disk unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('Disk unavailable');
  expect(name).toHaveValue('Original edited');
  expect(name.closest('fieldset')).not.toHaveAttribute('inert');
  expect(save).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(name).toHaveValue('Original');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(save).toHaveBeenCalledTimes(1);
});

it('retains a conflicted draft through failed reload and adopts only an explicit successful reload', async () => {
  const { client, read, save, user, name } = fixture();
  save.mockRejectedValueOnce(new RequestError('Changed on disk', 409));
  await user.type(name, ' edited');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Changed on disk');
  await act(async () => {
    client.setQueryData(['document'], {
      value: { name: 'External' },
      revision: 'external',
    });
  });
  expect(name).toHaveValue('Original edited');
  read.mockRejectedValueOnce(new Error('Read failed'));
  await user.click(screen.getByRole('button', { name: 'Reload latest' }));
  expect(await screen.findByText('Read failed')).toBeVisible();
  expect(name).toHaveValue('Original edited');
  read.mockResolvedValueOnce({ value: { name: 'Latest' }, revision: 'rev-3' });
  await user.click(screen.getByRole('button', { name: 'Reload latest' }));
  await waitFor(() => expect(name).toHaveValue('Latest'));
  await user.type(name, '!');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenLastCalledWith({ name: 'Latest!' }, 'rev-3');
});
