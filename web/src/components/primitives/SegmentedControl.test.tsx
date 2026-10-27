import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from './SegmentedControl.js';

const options = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark', disabled: true, hint: 'Not available yet' },
];

describe('SegmentedControl', () => {
  it('exposes one radio group with the current value selected', () => {
    render(
      <SegmentedControl
        label="Appearance"
        value="light"
        options={options}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'System' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeDisabled();
  });

  it('reports the chosen value and never the disabled one', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Appearance"
        value="light"
        options={options}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole('radio', { name: 'System' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(onChange.mock.calls).toEqual([['system']]);
  });
});
