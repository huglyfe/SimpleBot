import { type ReactElement } from 'react';
import {
  VARIABLE_NAME_MAX,
  VARIABLE_VALUE_MAX,
  variableWriteSchema,
  type SessionContext,
} from '@simplebot/shared';

import { Field } from '../primitives/Field.js';
import { RecordEditor } from './RecordEditor.js';

interface Draft {
  original: string | null;
  name: string;
  value: string;
}

function emptyDraft(): Draft {
  return { original: null, name: '', value: '' };
}

export function VariablesPanel({
  variables,
  onSet,
  onDelete,
}: {
  variables: SessionContext['variables'];
  onSet: (name: string, value: string, previousName?: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}): ReactElement {
  async function save(draft: Draft): Promise<void> {
    const parsed = variableWriteSchema.safeParse({
      name: draft.name,
      value: draft.value,
    });
    if (!parsed.success)
      throw new Error(
        draft.name.trim() === ''
          ? 'A variable needs a name.'
          : `A name is at most ${String(VARIABLE_NAME_MAX)} characters and a value at most ${String(VARIABLE_VALUE_MAX)}.`,
      );
    const { name, value } = parsed.data;
    if (name !== draft.original && variables.some((item) => item.name === name))
      throw new Error(
        `“${name}” already exists. Edit it directly to change it.`,
      );
    await onSet(name, value, draft.original ?? undefined);
  }
  function fields(draft: Draft, change: (next: Draft) => void): ReactElement {
    return (
      <>
        <Field label="Variable name" htmlFor="variable-name">
          <input
            id="variable-name"
            value={draft.name}
            maxLength={VARIABLE_NAME_MAX}
            onChange={(event) => change({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field label="Value" htmlFor="variable-value">
          <textarea
            id="variable-value"
            value={draft.value}
            maxLength={VARIABLE_VALUE_MAX}
            onChange={(event) =>
              change({ ...draft, value: event.target.value })
            }
          />
        </Field>
      </>
    );
  }

  return (
    <ul className="record-list">
      {variables.map((variable) => (
        <RecordEditor
          key={variable.name}
          title={variable.name}
          editLabel={`Edit variable ${variable.name}`}
          summary={variable.value}
          value={{
            original: variable.name,
            name: variable.name,
            value: variable.value,
          }}
          onSave={save}
          actionLabel="Save variable"
          remove={{
            description:
              'This variable will be removed from this conversation only.',
            label: `Delete variable ${variable.name}`,
            onClick: () => onDelete(variable.name),
          }}
        >
          {fields}
        </RecordEditor>
      ))}
      <RecordEditor
        title="Add variable"
        add
        value={emptyDraft()}
        onSave={save}
        actionLabel="Create variable"
      >
        {fields}
      </RecordEditor>
    </ul>
  );
}
