import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu } from './Menu.js';

function renderMenu(onSelect = vi.fn()) {
  render(
    <>
      <button type="button">outside</button>
      <Menu
        label="Actions for Morning walk"
        icon={<svg />}
        items={[
          { label: 'Edit title', onSelect },
          { label: 'Delete', destructive: true, onSelect: vi.fn() },
        ]}
      />
    </>,
  );
  return {
    trigger: screen.getByRole('button', { name: 'Actions for Morning walk' }),
    onSelect,
  };
}

describe('Menu', () => {
  it('opens from its trigger and reports expansion', async () => {
    const { trigger } = renderMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('closes on selection and returns focus to the trigger', async () => {
    const { trigger, onSelect } = renderMenu();
    await userEvent.click(trigger);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit title' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside pointerdown without stealing focus back', async () => {
    const { trigger } = renderMenu();
    await userEvent.click(trigger);

    const outside = screen.getByRole('button', { name: 'outside' });
    await userEvent.click(outside);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const { trigger } = renderMenu();
    await userEvent.click(trigger);

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
