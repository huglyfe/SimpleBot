import type { ReactElement } from 'react';
import type { McpDefinition } from '@simplebot/shared';
import { CredentialField } from './Secrets.js';
import { Field } from '../primitives/Field.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';

export type ServerRole = 'mcp' | 'memory';
export type Entries = [string, string][];
export type ServerDraft =
  | (Omit<Extract<McpDefinition, { type: 'stdio' }>, 'env'> & { env: Entries })
  | (Omit<Extract<McpDefinition, { type: 'streamable-http' }>, 'headers'> & {
      headers: Entries;
    });

export function ServerFields({
  kind,
  name,
  value,
  onChange,
}: {
  kind: ServerRole;
  name: string;
  value: ServerDraft;
  onChange: (next: ServerDraft) => void;
}): ReactElement {
  const transport = value.type;
  const prefix = `${kind}-${name}`;

  return (
    <fieldset className="provider-connection">
      <Field label="Transport">
        <SegmentedControl
          label={`Transport for ${name}`}
          value={transport}
          options={[
            { value: 'stdio', label: 'Stdio' },
            { value: 'streamable-http', label: 'HTTP' },
          ]}
          onChange={(next) =>
            onChange(
              next === 'stdio'
                ? { type: 'stdio', command: '', args: [], env: [] }
                : { type: 'streamable-http', url: '', headers: [] },
            )
          }
        />
      </Field>
      {transport === 'stdio' ? (
        <>
          <Field label="Command" htmlFor={`${prefix}-command`}>
            <input
              id={`${prefix}-command`}
              value={value.command}
              onChange={(event) =>
                onChange({ ...value, command: event.target.value })
              }
            />
          </Field>
          <StringListEditor
            label="Arguments"
            values={value.args}
            onChange={(args) => onChange({ ...value, args })}
          />
          <Field
            label="Working directory"
            htmlFor={`${prefix}-cwd`}
            description="Relative paths start at the SimpleBot root."
          >
            <input
              id={`${prefix}-cwd`}
              value={value.cwd ?? ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  cwd: event.target.value || undefined,
                })
              }
            />
          </Field>
          <StringMapEditor
            label="Environment"
            value={value.env}
            onChange={(env) => onChange({ ...value, env })}
          />
        </>
      ) : (
        <>
          <Field label="URL" htmlFor={`${prefix}-url`}>
            <input
              id={`${prefix}-url`}
              value={value.url}
              placeholder="https://example.test/mcp"
              onChange={(event) =>
                onChange({ ...value, url: event.target.value })
              }
            />
          </Field>
          <StringMapEditor
            label="Headers"
            value={value.headers}
            onChange={(headers) => onChange({ ...value, headers })}
          />
        </>
      )}
    </fieldset>
  );
}

function StringListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}): ReactElement {
  return (
    <Field label={label}>
      <div className="repeatable">
        {values.map((value, index) => (
          <div key={index} className="repeatable-row">
            <input
              aria-label={`Argument ${String(index + 1)}`}
              value={value}
              onChange={(event) =>
                onChange(
                  values.map((entry, position) =>
                    position === index ? event.target.value : entry,
                  ),
                )
              }
            />
            <button
              type="button"
              className="ui-button is-small is-danger"
              aria-label={`Remove argument ${String(index + 1)}`}
              onClick={() =>
                onChange(values.filter((_, position) => position !== index))
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ui-button is-small"
          onClick={() => onChange([...values, ''])}
        >
          Add argument
        </button>
      </div>
    </Field>
  );
}

function StringMapEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Entries;
  onChange: (next: Entries) => void;
}): ReactElement {
  return (
    <Field label={label}>
      <div className="repeatable">
        {value.map(([name, entryValue], index) => (
          <div key={index} className="repeatable-row is-pair">
            <input
              aria-label={`${label} name ${String(index + 1)}`}
              value={name}
              placeholder="Name"
              onChange={(event) =>
                onChange(
                  value.map((entry, position) =>
                    position === index
                      ? [event.target.value, entryValue]
                      : entry,
                  ),
                )
              }
            />
            <CredentialField
              label={`${label} value ${String(index + 1)}`}
              value={entryValue}
              onChange={(next) =>
                onChange(
                  value.map((entry, position) =>
                    position === index ? [name, next] : entry,
                  ),
                )
              }
            />
            <button
              type="button"
              className="ui-button is-small is-danger"
              aria-label={`Remove ${label.toLowerCase()} entry ${String(index + 1)}`}
              onClick={() =>
                onChange(value.filter((_, position) => position !== index))
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ui-button is-small"
          onClick={() => onChange([...value, ['', '']])}
        >
          Add {label.toLowerCase()} entry
        </button>
      </div>
    </Field>
  );
}
