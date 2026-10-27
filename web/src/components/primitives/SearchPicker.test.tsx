import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchPicker } from './SearchPicker.js';
import { filterFuzzy } from '../../lib/fuzzy.js';

const options = Array.from({ length: 400 }, (_, i) => ({
  value: `model-${String(i)}`,
  label: `Model ${String(i)}`,
  detail: `openrouter · vendor/model-${String(i)}`,
}));

describe('SearchPicker', () => {
  it('keeps an absent saved value visible alongside an empty catalog and never changes it on open', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <SearchPicker
        id="model"
        label="Main model"
        value="vendor/retired-model"
        options={[]}
        emptyMessage="No models found."
        onChange={select}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Main model' });
    expect(trigger).toHaveTextContent('vendor/retired-model');
    await user.click(trigger);
    expect(screen.getByText('No models found.')).toBeVisible();
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent(
      'Saved selection · not in catalog',
    );
    await user.click(screen.getByRole('button', { pressed: true }));
    expect(select).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('distinguishes an empty catalog from no search matches and still permits custom IDs', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <SearchPicker
        id="model"
        label="Model"
        value={null}
        options={[]}
        onChange={select}
        customOptions={(query) =>
          query.startsWith('custom/')
            ? [{ value: query, label: `Use ${query}` }]
            : []
        }
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Model' }));
    expect(screen.getByText('No options available.')).toBeVisible();
    const search = screen.getByRole('searchbox');
    await user.type(search, 'unknown');
    expect(screen.getByText('No matches.')).toBeVisible();
    await user.clear(search);
    await user.type(search, 'custom/model');
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(select).toHaveBeenCalledWith('custom/model');
  });

  it('finds a model in a large catalog, clears search, and returns keyboard focus', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <SearchPicker
        id="model"
        label="Main model"
        value="model-399"
        options={options}
        onChange={select}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Main model' });
    await user.click(trigger);
    const search = screen.getByRole('searchbox', { name: 'Search main model' });
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
    const choices = screen.getByRole('group', { name: 'Main model choices' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      within(choices).getAllByRole('button', { pressed: true })[0],
    ).toHaveTextContent('Model 399');
    await user.type(search, 'openrouter model 376');
    expect(
      within(choices).getByRole('button', { name: /Model 376/ }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    await user.type(search, 'model-376');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(select).toHaveBeenCalledWith('model-376');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes an unchanged choice without submitting', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <SearchPicker
        id="preset"
        label="Preset"
        value="model-1"
        options={options.slice(0, 2)}
        onChange={select}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Preset' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { pressed: true }));
    expect(select).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('retains an async selection failure and blocks dismissal while pending', async () => {
    const pending = Promise.withResolvers<undefined>();
    const user = userEvent.setup();
    const select = vi.fn().mockReturnValue(pending.promise);
    render(
      <SearchPicker
        id="preset"
        label="Preset"
        value="model-1"
        options={options.slice(0, 2)}
        onChange={select}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Preset' }));
    await user.click(screen.getByRole('button', { name: /Model 0/ }));
    const trigger = screen.getByRole('button', { name: 'Preset' });
    expect(trigger).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('group', { name: 'Preset choices' })).toBeVisible();
    pending.reject(new Error('Selection refused'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Selection refused',
    );
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('ranks exact and prefix names ahead of loose matches across fields', () => {
    const values = [
      { name: 'Other', provider: 'openrouter', id: 'sonnet' },
      { name: 'Sonnet', provider: 'anthropic', id: 'a' },
      { name: 'Some other name text', provider: 'other', id: 'b' },
    ];
    expect(
      filterFuzzy(values, 'anthropic sonnet', (v) => [
        v.name,
        v.provider,
        v.id,
      ]),
    ).toEqual([values[1]]);
    expect(
      filterFuzzy(values, 'sonnet', (v) => [v.name, v.provider, v.id]).slice(
        0,
        2,
      ),
    ).toEqual(values.slice(0, 2));
  });
});
