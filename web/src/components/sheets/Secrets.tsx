import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { secretNameSchema } from '@simplebot/shared';
import { getSecrets, removeSecret, saveSecret } from '../../api.js';
import { Field } from '../primitives/Field.js';
import { RecordEditor } from './RecordEditor.js';
import { Section } from './Section.js';

const queryKey = ['secrets'];

/** References belong to panel drafts; secret values only live in the focused editor. */
export function CredentialField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const secrets = useQuery({ queryKey, queryFn: getSecrets });
  const saved = value.startsWith('secret:');
  return (
    <div>
      <Field label={`${label} source`} htmlFor={`${id}-source`}>
        <select
          id={`${id}-source`}
          value={saved ? 'saved' : 'environment'}
          onChange={(event) =>
            onChange(event.target.value === 'saved' ? 'secret:' : '')
          }
        >
          <option value="environment">Environment reference</option>
          <option value="saved">Saved secret</option>
        </select>
      </Field>
      <Field label={label} htmlFor={id}>
        {saved ? (
          <select
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="secret:">Choose a saved secret</option>
            {value !== 'secret:' &&
            !secrets.data?.names.includes(value.slice(7)) ? (
              <option value={value}>{value.slice(7)} (unavailable)</option>
            ) : null}
            {(secrets.data?.names ?? []).map((name) => (
              <option key={name} value={`secret:${name}`}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            value={value}
            placeholder="${NAME}"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </Field>
      {saved && secrets.error ? (
        <p role="alert" className="ui-hint is-error">
          {secrets.error.message}
        </p>
      ) : null}
    </div>
  );
}

export function SecretsSection() {
  const secrets = useQuery({ queryKey, queryFn: getSecrets });
  const client = useQueryClient();
  const data = secrets.data;
  async function save(name: string, value: string) {
    if (data === undefined) return;
    secretNameSchema.parse(name);
    if (!value) throw new Error('Enter a secret value.');
    client.setQueryData(queryKey, await saveSecret(name, value, data.revision));
  }
  return (
    <Section
      title="Saved secrets"
      description="Saved immediately, separately from panel settings. Values cannot be revealed and are excluded from backups. Refresh capabilities after changing an MCP or Memory credential."
    >
      <button
        type="button"
        className="ui-button is-small"
        onClick={() => void secrets.refetch()}
        disabled={secrets.isFetching}
      >
        Reload secrets
      </button>
      {secrets.error ? (
        <p role="alert" className="ui-hint is-error">
          {secrets.error.message}
        </p>
      ) : null}
      {data === undefined ? (
        <p>Loading secrets…</p>
      ) : (
        <ul className="record-list">
          {data.names.map((name) => (
            <RecordEditor
              key={name}
              title={name}
              editLabel={`Replace secret ${name}`}
              summary="Configured"
              value=""
              onSave={(value) => save(name, value)}
              remove={{
                label: `Remove secret ${name}`,
                description:
                  'Connections must stop referencing this secret before it can be removed.',
                onClick: async () => {
                  client.setQueryData(
                    queryKey,
                    await removeSecret(name, data.revision),
                  );
                },
              }}
            >
              {(value, change) => (
                <SecretValue value={value} onChange={change} />
              )}
            </RecordEditor>
          ))}
          <RecordEditor
            title="Add secret"
            add
            value={{ name: '', value: '' }}
            onSave={({ name, value }) => {
              if (data.names.includes(name))
                throw new Error(
                  'This secret already exists. Use Replace secret.',
                );
              return save(name, value);
            }}
          >
            {(draft, change) => (
              <>
                <Field label="Secret name" htmlFor="secret-name">
                  <input
                    id="secret-name"
                    value={draft.name}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) =>
                      change({ ...draft, name: event.target.value })
                    }
                  />
                </Field>
                <SecretValue
                  value={draft.value}
                  onChange={(value) => change({ ...draft, value })}
                />
              </>
            )}
          </RecordEditor>
        </ul>
      )}
    </Section>
  );
}

function SecretValue({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field label="Secret value" htmlFor={id}>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
