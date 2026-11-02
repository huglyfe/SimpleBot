import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '@simplebot/shared';

import { SchedulesPanel } from './SchedulesPanel.js';

const MORNING_SCHEDULE = {
  id: '00000000-0000-4000-8000-000000000008',
  name: 'Morning hello',
  expression: '0 9 * * *',
  prompt: 'Say good morning.',
  enabled: true,
  nextRunAt: '2026-08-24T13:00:00.000Z',
  nextRunError: null,
} satisfies SessionContext['schedules'][number];

function renderPanel(
  onSave = vi.fn(() => Promise.resolve()),
  schedules: SessionContext['schedules'] = [],
) {
  const onDelete = vi.fn(() => Promise.resolve());
  render(
    <SchedulesPanel
      schedules={schedules}
      onSave={onSave}
      onDelete={onDelete}
    />,
  );
  return { onSave, onDelete };
}

describe('SchedulesPanel', () => {
  it('creates a schedule from the collection row using application timezone ownership', async () => {
    const user = userEvent.setup();
    const { onSave } = renderPanel();

    expect(screen.queryByLabelText('Schedule name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add schedule' }));
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).toHaveClass(
      'ui-switch',
    );
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveFocus();
    expect(screen.queryByLabelText('Timezone')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'Check in',
      expression: '0 9 * * *',
      prompt: 'Check in naturally.',
      enabled: true,
    });
  });

  it('selects an existing schedule into the same editor', async () => {
    const user = userEvent.setup();
    const { onSave } = renderPanel(
      vi.fn(() => Promise.resolve()),
      [MORNING_SCHEDULE],
    );

    expect(screen.queryByText('Edit schedule')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Edit schedule Morning hello' }),
    );
    expect(screen.getByLabelText('Schedule name')).toHaveValue('Morning hello');
    await user.clear(screen.getByLabelText('Prompt'));
    await user.type(screen.getByLabelText('Prompt'), 'Start the day gently.');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000008',
        prompt: 'Start the day gently.',
      }),
    );
  });

  it('keeps the schedule editor and error visible when a save fails', async () => {
    const user = userEvent.setup();
    renderPanel(vi.fn(() => Promise.reject(new Error('Invalid cron'))));

    await user.click(screen.getByRole('button', { name: 'Add schedule' }));
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid cron');
    expect(screen.getByLabelText('Schedule name')).toHaveValue('Check in');
  });

  it('confirms deletion and reports a refused delete', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(() => Promise.reject(new Error('Session locked')));
    render(
      <SchedulesPanel
        schedules={[MORNING_SCHEDULE]}
        onSave={vi.fn(() => Promise.resolve())}
        onDelete={onDelete}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Delete schedule Morning hello' }),
    );
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('will stop running');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith(MORNING_SCHEDULE.id);
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Session locked',
    );
  });

  it('shows why a schedule has no next run instead of hiding it', () => {
    render(
      <SchedulesPanel
        schedules={[
          {
            id: '00000000-0000-4000-8000-000000000009',
            name: 'Unreadable',
            expression: 'not a cron',
            prompt: 'Check in',
            enabled: true,
            nextRunAt: null,
            nextRunError: 'Invalid schedule expression',
          },
        ]}
        onSave={vi.fn(() => Promise.resolve())}
        onDelete={vi.fn(() => Promise.resolve())}
      />,
    );

    // The row the timer had to skip is exactly the row the operator must fix.
    expect(screen.getByText('Unreadable')).toBeTruthy();
    expect(screen.getByText('Invalid schedule expression')).toBeTruthy();
    expect(screen.queryByText(/No next run/u)).toBeNull();
  });
});
