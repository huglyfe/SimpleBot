import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { SPEECH_DEFAULTS, type AppSettings } from '@simplebot/shared';

import { getProviderList, getProviderModels } from '../../api.js';
import { SearchPicker } from '../primitives/SearchPicker.js';
import { Field } from '../primitives/Field.js';
import { RecordEditor } from './RecordEditor.js';
import { CredentialField, SecretsSection } from './Secrets.js';
import { Section } from './Section.js';

export function ProviderSheet({
  value,
  saved,
  patch,
}: {
  value: Pick<AppSettings, 'providers' | 'tts'>;
  saved: AppSettings['providers'];
  patch: (key: string, next: unknown) => void;
}): ReactElement {
  const providers = value.providers;
  const ttsConfigured = value.tts !== null;
  const tts = value.tts ?? {
    baseUrl: '',
    apiKey: '',
    model: '',
    ...SPEECH_DEFAULTS,
  };
  const catalog = useQuery({
    queryKey: ['providers'],
    queryFn: getProviderList,
  });

  function setProvider(
    id: string,
    next: AppSettings['providers'][string],
  ): void {
    return patch('providers', { ...providers, [id]: next });
  }

  function removeProvider(id: string): void {
    const next = { ...providers };
    delete next[id];
    return patch('providers', next);
  }

  return (
    <>
      <Section title="Chat providers">
        <ul className="record-list">
          {Object.entries(providers).map(([id, entry]) => (
            <ProviderRecord
              key={id}
              id={id}
              value={entry}
              unsaved={JSON.stringify(entry) !== JSON.stringify(saved[id])}
              onSave={(next) => setProvider(id, next)}
              onRemove={() => removeProvider(id)}
            />
          ))}
          <RecordEditor
            actionLabel="Done"
            title="Add provider"
            add
            value={{ id: '', config: {} }}
            onSave={({ id, config }) => {
              if (!id) throw new Error('Choose a provider.');
              return setProvider(id, config);
            }}
          >
            {(draft, change) => (
              <>
                <Field label="Add provider" htmlFor="provider-add">
                  <SearchPicker
                    label="Add provider"
                    id="provider-add"
                    value={draft.id || null}
                    emptyMessage={
                      catalog.isError
                        ? 'Provider list unavailable.'
                        : 'Loading providers…'
                    }
                    options={(catalog.data ?? [])
                      .filter(
                        (provider) => !Object.hasOwn(providers, provider.id),
                      )
                      .map((provider) => ({
                        value: provider.id,
                        label: provider.name,
                        detail: provider.id,
                      }))}
                    onChange={(id) => change({ id, config: {} })}
                  />
                </Field>
                {draft.id === '' ? null : (
                  <ProviderConnection
                    id={draft.id}
                    value={draft.config}
                    onChange={(config) => change({ ...draft, config })}
                  />
                )}
              </>
            )}
          </RecordEditor>
        </ul>
      </Section>

      <Section title="Speech">
        <ul className="record-list">
          <RecordEditor
            actionLabel="Done"
            title={
              ttsConfigured ? 'Speech connection' : 'Add speech connection'
            }
            add={!ttsConfigured}
            value={tts}
            summary={ttsConfigured ? tts.baseUrl || 'Not set' : undefined}
            onSave={(next) => patch('tts', next)}
            remove={
              ttsConfigured
                ? {
                    label: 'Remove speech connection',
                    description:
                      'The speech connection will be removed when you save the panel.',
                    onClick: () => patch('tts', null),
                  }
                : undefined
            }
          >
            {(draft, change) => (
              <>
                <Field label="Base URL" htmlFor="tts-base-url">
                  <input
                    id="tts-base-url"
                    value={draft.baseUrl}
                    placeholder="https://speech.example/v1"
                    onChange={(event) =>
                      change({ ...draft, baseUrl: event.target.value })
                    }
                  />
                </Field>
                <CredentialField
                  label="API key reference"
                  value={draft.apiKey}
                  onChange={(apiKey) => change({ ...draft, apiKey })}
                />
                <Field label="Model" htmlFor="tts-model">
                  <input
                    id="tts-model"
                    value={draft.model}
                    onChange={(event) =>
                      change({ ...draft, model: event.target.value })
                    }
                  />
                </Field>
              </>
            )}
          </RecordEditor>
        </ul>
      </Section>
      <SecretsSection />
    </>
  );
}

function ProviderConnection({
  id,
  value,
  onChange,
}: {
  id: string;
  value: AppSettings['providers'][string];
  onChange: (next: AppSettings['providers'][string]) => void;
}): ReactElement {
  return (
    <fieldset className="provider-connection">
      <legend>{id}</legend>
      <CredentialField
        label="API key reference"
        value={value.apiKey ?? ''}
        onChange={(apiKey) =>
          onChange({ ...value, apiKey: apiKey || undefined })
        }
      />
      <Field label="Base URL" htmlFor={`provider-${id}-url`}>
        <input
          id={`provider-${id}-url`}
          value={value.baseUrl ?? ''}
          placeholder="Provider default"
          onChange={(event) =>
            onChange({ ...value, baseUrl: event.target.value || undefined })
          }
        />
      </Field>
    </fieldset>
  );
}

function ProviderRecord({
  id,
  unsaved,
  value,
  onSave,
  onRemove,
}: {
  id: string;
  value: AppSettings['providers'][string];
  onSave: (value: AppSettings['providers'][string]) => void;
  onRemove: () => void;
  unsaved: boolean;
}): ReactElement {
  const models = useQuery({
    queryKey: ['provider-models', id],
    queryFn: () => getProviderModels(id),
    enabled: !unsaved,
  });
  const failure = unsaved
    ? null
    : models.isError
      ? models.error.message
      : (models.data?.error ?? null);
  const count = models.data?.models.length;
  const countLabel = `${String(count)} ${count === 1 ? 'model' : 'models'}`;
  const status = unsaved ? (
    'Unsaved'
  ) : failure !== null ? (
    'Catalog unavailable'
  ) : count === undefined ? (
    'Loading models…'
  ) : (
    <span className="provider-model-count">{countLabel}</span>
  );
  const url = value.baseUrl ?? 'Default URL';
  return (
    <RecordEditor
      actionLabel="Done"
      title={id}
      value={value}
      summary={
        <span className="provider-summary">
          <span className="provider-url" title={url}>
            {url}
          </span>
          <span> · {status}</span>
        </span>
      }
      detail={
        failure === null ? undefined : (
          <span className="ui-hint is-error">{failure}</span>
        )
      }
      onSave={onSave}
      remove={{
        label: `Remove provider ${id}`,
        description: 'This provider will be removed when you save the panel.',
        onClick: onRemove,
      }}
    >
      {(draft, change) => (
        <ProviderConnection id={id} value={draft} onChange={change} />
      )}
    </RecordEditor>
  );
}
