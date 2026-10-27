import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type {
  CapabilityCatalog,
  DependencyConfigDraft,
} from '@simplebot/shared';

import {
  getCapabilities,
  getDependencies,
  saveDependencies,
  refreshCapabilities,
  getSkills,
} from '../../api.js';
import { IconButton } from '../primitives/IconButton.js';
import { RefreshIcon } from '../../icons.js';
import { errorMessage } from '../../lib/errorMessage.js';
import { SkillEditors } from './SkillEditors.js';
import { DependencyEditors } from './DependencyEditors.js';
import { AuthoredForm } from './AuthoredForm.js';
import { SecretsSection } from './Secrets.js';
import { Section } from './Section.js';
import { useAuthoredEditor, type AuthoredQuery } from './useAuthoredEditor.js';

export function CapabilitiesSheet(): ReactElement {
  const catalog = useQuery({
    queryKey: ['capabilities'],
    queryFn: getCapabilities,
  });
  const dependencies = useQuery({
    queryKey: ['dependencies'],
    queryFn: getDependencies,
  });
  const skills = useQuery({ queryKey: ['skills'], queryFn: getSkills });

  if (
    catalog.data === undefined ||
    dependencies.data === undefined ||
    skills.data === undefined
  ) {
    const error = catalog.error ?? dependencies.error ?? skills.error;
    return error === null ? (
      <p className="ui-empty">Loading capabilities…</p>
    ) : (
      <p className="ui-notice" role="alert">
        {error.message}
      </p>
    );
  }

  return (
    <>
      {catalog.isError ? (
        <p className="ui-notice" role="alert">
          Could not refresh capability status: {catalog.error.message}
          <button
            type="button"
            className="ui-button is-small"
            disabled={catalog.isFetching}
            onClick={() => void catalog.refetch()}
          >
            Refresh status
          </button>
        </p>
      ) : null}
      <CapabilitiesEditor
        catalog={catalog.data}
        dependencies={dependencies}
        skills={skills.data}
      />
    </>
  );
}

function CapabilitiesEditor({
  catalog,
  dependencies,
  skills,
}: {
  catalog: CapabilityCatalog;
  dependencies: AuthoredQuery<DependencyConfigDraft>;
  skills: Awaited<ReturnType<typeof getSkills>>;
}): ReactElement {
  const cache = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useAuthoredEditor({
    query: dependencies,
    save: async (value, revision) => {
      const next = { value, revision: await saveDependencies(value, revision) };
      cache.setQueryData(['dependencies'], next);
      void cache.invalidateQueries({
        queryKey: ['settings'],
        refetchType: 'none',
      });
      return next;
    },
  });

  return (
    <AuthoredForm
      {...editor}
      disabled={refreshing || editor.saving}
      onSave={editor.update}
      error={error ?? editor.error}
      discard={() => {
        editor.discard();
        setError(null);
      }}
      actions={
        <IconButton
          label="Refresh capabilities"
          warning
          disabled={refreshing || editor.saving || editor.changed}
          onClick={() => {
            setRefreshing(true);
            setError(null);
            void refreshCapabilities()
              .then((next) => {
                cache.setQueryData(['capabilities'], next);
              })
              .catch((caught: unknown) =>
                setError(errorMessage(caught, 'Refresh failed')),
              )
              .finally(() => setRefreshing(false));
          }}
        >
          <RefreshIcon className={refreshing ? 'ui-saving' : undefined} />
        </IconButton>
      }
    >
      <SkillEditors skills={skills} />
      <Section
        title="External dependencies"
        description="MCP and Memory reconnect; Docker targets are re-inspected without restarting containers."
      >
        <DependencyEditors
          value={editor.value}
          catalog={catalog}
          onChange={editor.change}
        />
      </Section>
      <SecretsSection />
    </AuthoredForm>
  );
}
