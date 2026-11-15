import { useId, useState } from 'react';
import type { ServerValue } from '@simplebot/shared';
import { Field } from '../primitives/Field.js';

type Source = 'plain' | 'environment' | 'private';
const REFERENCE = /^\$\{([^}]*)\}$/u;

function sourceOf(value: ServerValue, plain: boolean): Source {
  if (typeof value !== 'string') return 'private';
  return !plain || REFERENCE.test(value) ? 'environment' : 'plain';
}

/**
 * One saved value: plain text (MCP env and headers only), an environment
 * variable, or a private value. Private values are write-only: the field
 * starts empty, typing replaces the saved value, and clearing keeps it.
 */
export function ValueField({
  label,
  value,
  onChange,
  plain = false,
}: {
  label: string;
  value: ServerValue;
  onChange: (value: ServerValue) => void;
  plain?: boolean;
}) {
  const id = useId();
  const [source, setSource] = useState(() => sourceOf(value, plain));
  const [saved] = useState(() =>
    typeof value !== 'string' && 'private' in value ? value : null,
  );
  return (
    <div>
      <Field label={`${label} source`} htmlFor={`${id}-source`}>
        <select
          id={`${id}-source`}
          value={source}
          onChange={(event) => {
            const next = event.target.value as Source;
            setSource(next);
            onChange(next === 'private' ? (saved ?? { value: '' }) : '');
          }}
        >
          {plain ? <option value="plain">Plain text</option> : null}
          <option value="environment">Environment variable</option>
          <option value="private">Private value</option>
        </select>
      </Field>
      <Field label={label} htmlFor={id}>
        {source === 'private' ? (
          <input
            id={id}
            type="password"
            autoComplete="new-password"
            placeholder={
              saved === null ? 'Enter value' : 'Saved; type to replace'
            }
            value={
              typeof value !== 'string' && 'value' in value ? value.value : ''
            }
            onChange={(event) =>
              onChange(
                event.target.value === '' && saved !== null
                  ? saved
                  : { value: event.target.value },
              )
            }
          />
        ) : source === 'environment' ? (
          <input
            id={id}
            value={
              typeof value === 'string'
                ? (REFERENCE.exec(value)?.[1] ?? value)
                : ''
            }
            placeholder="VARIABLE_NAME"
            spellCheck={false}
            onChange={(event) =>
              onChange(event.target.value ? `\${${event.target.value}}` : '')
            }
          />
        ) : (
          <input
            id={id}
            value={typeof value === 'string' ? value : ''}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
