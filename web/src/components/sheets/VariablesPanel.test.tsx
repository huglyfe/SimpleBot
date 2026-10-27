import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '@simplebot/shared';

import { VariablesPanel } from './VariablesPanel.js';

type SetVariable = (
  name: string,
  value: string,
  previousName?: string,
) => Promise<void>;
type DeleteVariable = (name: string) => Promise<void>;

function renderPanel(
  variables: Record<string, string> = {},
  handlers: { onSet?: SetVariable; onDelete?: DeleteVariable } = {},
) {
  const onSet = vi.fn<SetVariable>(handlers.onSet ?? (() => Promise.resolve()));
  const onDelete = vi.fn<DeleteVariable>(
    handlers.onDelete ?? (() => Promise.resolve()),
  );
  render(
    <VariablesPanel
      variables={
        Object.entries(variables).map(([name, value]) => ({
          name,
          value,
        })) satisfies SessionContext['variables']
      }
      onSet={onSet}
      onDelete={onDelete}
    />,
  );
  return { onSet, onDelete };
}

async function fill(name: string, value: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add variable' }));
  await user.clear(screen.getByLabelText('Variable name'));
  await user.type(screen.getByLabelText('Variable name'), name);
  await user.clear(screen.getByLabelText('Value'));
  await user.type(screen.getByLabelText('Value'), value);
  return user;
}

describe('VariablesPanel', () => {
  it('creates the first variable from the empty state', async () => {
    const { onSet } = renderPanel();

    expect(screen.queryByLabelText('Variable name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add variable' })).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add variable' }));
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveFocus();
    await user.type(screen.getByLabelText('Variable name'), 'mood');
    await user.type(screen.getByLabelText('Value'), 'restless');
    await user.click(screen.getByRole('button', { name: 'Create variable' }));

    expect(onSet).toHaveBeenCalledWith('mood', 'restless', undefined);
    expect(screen.queryByLabelText('Variable name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add variable' })).toHaveFocus();
  });

  it('writes the trimmed name the route would store', async () => {
    const { onSet } = renderPanel();

    const user = await fill('  mood  ', 'restless');
    await user.click(screen.getByRole('button', { name: 'Create variable' }));

    expect(onSet).toHaveBeenCalledWith('mood', 'restless', undefined);
  });

  it('refuses a name that is already taken instead of overwriting it', async () => {
    const { onSet } = renderPanel({ mood: 'restless' });

    const user = await fill('mood', 'calm');
    await user.click(screen.getByRole('button', { name: 'Create variable' }));

    expect(onSet).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
  });

  it('rejects a nameless variable before it reaches the route', async () => {
    const { onSet } = renderPanel();

    const user = await fill('   ', 'restless');
    await user.click(screen.getByRole('button', { name: 'Create variable' }));

    expect(onSet).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('needs a name');
  });

  it('edits a variable in place without touching its name', async () => {
    const { onSet, onDelete } = renderPanel({ mood: 'restless' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Edit variable/u }));
    await user.clear(screen.getByLabelText('Value'));
    await user.type(screen.getByLabelText('Value'), 'calm');
    await user.click(screen.getByRole('button', { name: 'Save variable' }));

    expect(onSet).toHaveBeenCalledWith('mood', 'calm', 'mood');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renames with one atomic write', async () => {
    const order: string[] = [];
    const { onSet, onDelete } = renderPanel(
      { mood: 'restless' },
      {
        onSet: () => {
          order.push('set');
          return Promise.resolve();
        },
        onDelete: () => {
          order.push('delete');
          return Promise.resolve();
        },
      },
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Edit variable/u }));
    await user.clear(screen.getByLabelText('Variable name'));
    await user.type(screen.getByLabelText('Variable name'), 'temper');
    await user.click(screen.getByRole('button', { name: 'Save variable' }));

    expect(onSet).toHaveBeenCalledWith('temper', 'restless', 'mood');
    expect(onDelete).not.toHaveBeenCalled();
    expect(order).toEqual(['set']);
  });

  it('keeps the entered variable and reports why when the write fails', async () => {
    const onSet = vi.fn(() => Promise.reject(new Error('Session is locked')));
    renderPanel({}, { onSet });

    const user = await fill('mood', 'restless');
    await user.click(screen.getByRole('button', { name: 'Create variable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session is locked',
    );
    expect(screen.getByLabelText('Variable name')).toHaveValue('mood');
    expect(screen.getByLabelText('Value')).toHaveValue('restless');
  });

  it('reports a failed delete rather than dropping it', async () => {
    const onDelete = vi.fn(() =>
      Promise.reject(new Error('Session is locked')),
    );
    renderPanel({ mood: 'restless' }, { onDelete });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Delete variable/u }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('this conversation only');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Session is locked',
    );
  });
});
