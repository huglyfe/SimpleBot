import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import { AdvancedSettings, type AdvancedSetting } from './AdvancedSettings.js';

const SETTINGS: AdvancedSetting[] = [
  {
    key: 'maxToolCallsPerTurn',
    label: 'Tool calls per turn',
    description: 'How many tools one turn may run.',
    fallback: 6,
    keywords: ['tools'],
  },
  {
    key: 'terminalTimeoutMs',
    label: 'Terminal timeout',
    description: 'Milliseconds one terminal command may run.',
    fallback: 120000,
    unit: 'ms',
    keywords: ['docker'],
  },
];

function renderPanel(initial: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [values, setValues] = useState(initial);
    return (
      <AdvancedSettings
        title="Limits"
        description="Engine ceilings."
        settings={SETTINGS}
        values={values}
        onChange={(key, next) => {
          onChange(key, next);
          setValues((current) => ({ ...current, [key]: next }));
        }}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

describe('the advanced settings surface', () => {
  it('shows no limit until the operator asks for one', () => {
    renderPanel();
    expect(
      screen.getByRole('searchbox', { name: /find a setting/iu }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Tool calls per turn'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Using defaults.')).toBeInTheDocument();
  });

  it('reveals a matching setting as the operator types', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('searchbox'), 'docker');
    expect(screen.getByLabelText('Terminal timeout')).toHaveValue(120000);
    expect(
      screen.queryByLabelText('Tool calls per turn'),
    ).not.toBeInTheDocument();
  });

  it('says so when nothing matches instead of showing an empty section', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText(/no setting matches/iu)).toBeInTheDocument();
  });

  it('reports an edit and keeps the changed setting on screen without a query', async () => {
    const user = userEvent.setup();
    const onChange = renderPanel();
    await user.type(screen.getByRole('searchbox'), 'tool calls');
    const field = screen.getByLabelText('Tool calls per turn');
    await user.clear(field);
    await user.type(field, '12');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('maxToolCallsPerTurn', 12);

    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByLabelText('Tool calls per turn')).toHaveValue(12);
    expect(screen.queryByLabelText('Terminal timeout')).not.toBeInTheDocument();
  });

  it('offers a reset that names the value it returns to', async () => {
    const user = userEvent.setup();
    const onChange = renderPanel({ terminalTimeoutMs: 5000 });
    const reset = screen.getByRole('button', { name: /reset to 120000ms/iu });
    await user.click(reset);
    expect(onChange).toHaveBeenLastCalledWith('terminalTimeoutMs', 120000);
    expect(screen.queryByLabelText('Terminal timeout')).not.toBeInTheDocument();
  });
});
