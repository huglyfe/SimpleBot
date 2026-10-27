import { type ReactElement } from 'react';
import type { ScheduleWrite, SessionContext } from '@simplebot/shared';

import { Field } from '../primitives/Field.js';
import { RecordEditor } from './RecordEditor.js';

function emptyDraft(): ScheduleWrite {
  return {
    name: 'Check in',
    expression: '0 9 * * *',
    prompt: 'Check in naturally.',
    enabled: true,
  };
}

export function SchedulesPanel({
  timezone,
  schedules,
  onSave,
  onDelete,
}: {
  timezone: string;
  schedules: SessionContext['schedules'];
  onSave: (schedule: ScheduleWrite) => Promise<void>;
  onDelete: (scheduleId: string) => Promise<void>;
}): ReactElement {
  function fields(
    draft: ScheduleWrite,
    change: (next: ScheduleWrite) => void,
  ): ReactElement {
    return (
      <>
        <Field label="Schedule name" htmlFor="cron-name">
          <input
            id="cron-name"
            value={draft.name}
            onChange={(event) => change({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field
          label="Cron expression"
          htmlFor="cron-expression"
          hint="Minute, hour, day, month, weekday."
        >
          <input
            id="cron-expression"
            value={draft.expression}
            onChange={(event) =>
              change({ ...draft, expression: event.target.value })
            }
          />
        </Field>
        <Field
          label="Prompt"
          htmlFor="cron-prompt"
          hint="What the bot should do."
        >
          <textarea
            id="cron-prompt"
            value={draft.prompt}
            onChange={(event) =>
              change({ ...draft, prompt: event.target.value })
            }
          />
        </Field>
        <Field label="Enabled" htmlFor="cron-enabled">
          <input
            id="cron-enabled"
            className="ui-switch"
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              change({ ...draft, enabled: event.target.checked })
            }
          />
        </Field>
      </>
    );
  }

  return (
    <ul className="record-list">
      {schedules.map((schedule) => (
        <RecordEditor
          key={schedule.id}
          title={schedule.name}
          editLabel={`Edit schedule ${schedule.name}`}
          summary={schedule.prompt}
          detail={
            <>
              <span>
                {schedule.expression} ·{' '}
                {schedule.enabled ? 'enabled' : 'disabled'}
              </span>
              <span
                className={
                  schedule.nextRunError === null ? 'muted' : 'ui-hint is-error'
                }
              >
                {schedule.nextRunError ??
                  (schedule.nextRunAt === null
                    ? 'No next run'
                    : `Next run ${new Date(schedule.nextRunAt).toLocaleString(undefined, { timeZone: timezone, timeZoneName: 'short' })}`)}
              </span>
            </>
          }
          value={{
            id: schedule.id,
            name: schedule.name,
            expression: schedule.expression,
            prompt: schedule.prompt,
            enabled: schedule.enabled,
          }}
          onSave={onSave}
          actionLabel="Save schedule"
          remove={{
            description: 'This schedule will stop running.',
            label: `Delete schedule ${schedule.name}`,
            onClick: () => onDelete(schedule.id),
          }}
        >
          {fields}
        </RecordEditor>
      ))}
      <RecordEditor
        title="Add schedule"
        add
        value={emptyDraft()}
        onSave={onSave}
        actionLabel="Create schedule"
      >
        {fields}
      </RecordEditor>
    </ul>
  );
}
