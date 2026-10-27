/** One selected conversation preset, with a revision-checked file draft. */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { Preset } from '@simplebot/shared';

import { RequestError, deletePreset, getPresetDocument } from '../../api.js';
import { errorMessage } from '../../lib/errorMessage.js';
import { DotsIcon } from '../../icons.js';
import { Menu } from '../primitives/Menu.js';
import { DeleteConfirmDialog } from '../primitives/DeleteConfirmDialog.js';
import { FocusedEditor } from './FocusedEditor.js';
import { PresetFields } from './PresetFields.js';
import { PresetModels } from './PresetModels.js';
import { PresetSelect } from './PresetSelect.js';
import { UnsavedChangesDialog } from '../primitives/UnsavedChangesDialog.js';
import { Field } from '../primitives/Field.js';
import { AuthoredForm } from './AuthoredForm.js';
import { authoredSlug } from './slugs.js';
import { useAuthoredEditor, type AuthoredQuery } from './useAuthoredEditor.js';

export function PresetSheet({
  slug,
  onSelectPreset,
  save,
  ttsConfigured,
}: {
  slug: string;
  onSelectPreset: (slug: string) => Promise<void>;
  save: (
    path: string,
    value: Record<string, unknown>,
    revision: string,
  ) => Promise<string>;
  ttsConfigured: boolean;
}): ReactElement {
  const path = `presets/${encodeURIComponent(slug)}`;
  const preset = useQuery({
    queryKey: ['authored', path],
    queryFn: () => getPresetDocument(slug),
  });
  if (preset.data === undefined)
    return preset.isError ? (
      <p className="ui-notice" role="alert">
        {preset.error.message}
      </p>
    ) : (
      <p className="ui-empty">Loading preset…</p>
    );
  return (
    <PresetEditor
      key={slug}
      slug={slug}
      path={path}
      query={preset}
      save={save}
      onSelectPreset={onSelectPreset}
      ttsConfigured={ttsConfigured}
    />
  );
}

function PresetEditor({
  slug,
  path,
  query,
  save,
  onSelectPreset,
  ttsConfigured,
}: {
  slug: string;
  path: string;
  query: AuthoredQuery<Preset>;
  save: (
    path: string,
    value: Record<string, unknown>,
    revision: string,
  ) => Promise<string>;
  onSelectPreset: (slug: string) => Promise<void>;
  ttsConfigured: boolean;
}): ReactElement {
  const editor = useAuthoredEditor({
    query,
    save: async (draft, revision) => ({
      value: draft,
      revision: await save(path, draft, revision),
    }),
  });
  const { value: preset, change } = editor;
  const cache = useQueryClient();
  const [management, setManagement] = useState<
    'clone' | 'rename' | 'delete' | null
  >(null);

  const [deleteSlug, setDeleteSlug] = useState(slug);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  function patch<K extends keyof Preset>(key: K, value: Preset[K]): void {
    change((current) => ({ ...current, [key]: value }));
  }

  return (
    <AuthoredForm {...editor} onSave={() => editor.update()}>
      <section className="settings-section">
        <div className="preset-picker">
          <PresetSelect
            id="preset-slug"
            label="Preset"
            hideLabel
            value={slug}
            onChange={(next) =>
              editor.changed ? setSwitching(next) : onSelectPreset(next)
            }
          />
          <Menu
            label="Preset actions"
            icon={<DotsIcon />}
            items={[
              { label: 'Clone preset', onSelect: () => setManagement('clone') },
              {
                label: 'Rename preset',
                onSelect: () => setManagement('rename'),
              },
              {
                label: 'Delete preset',
                destructive: true,
                disabled: editor.saving,
                onSelect: () => setManagement('delete'),
              },
            ]}
          />
        </div>
      </section>
      {managementError ? (
        <p className="ui-notice" role="alert">
          {managementError}
        </p>
      ) : null}
      {switching === null ? null : (
        <UnsavedChangesDialog
          onSave={() => editor.update()}
          onCancel={() => setSwitching(null)}
          onContinue={async () => {
            await onSelectPreset(switching);
            setSwitching(null);
          }}
        />
      )}
      {management === 'clone' || management === 'rename' ? (
        <FocusedEditor
          title={management === 'clone' ? 'Clone preset' : 'Rename preset'}
          actionLabel={management === 'clone' ? 'Clone' : 'Done'}
          value={management === 'clone' ? '' : (preset.name ?? slug)}
          valid={(name) =>
            management === 'clone'
              ? authoredSlug(name) !== ''
              : name.trim().length > 0
          }
          onClose={() => setManagement(null)}
          onSave={async (name) => {
            if (management === 'rename') return patch('name', name.trim());
            const target = authoredSlug(name);
            try {
              await save(
                `presets/${encodeURIComponent(target)}`,
                { ...preset, name: name.trim() },
                'missing',
              );
            } catch (error) {
              if (error instanceof RequestError && error.status === 409)
                throw new Error(`A preset named ${target} already exists.`, {
                  cause: error,
                });
              throw error;
            }
            try {
              await onSelectPreset(target);
            } catch (error) {
              setManagementError(
                `Created ${target}, but could not select it: ${errorMessage(error, 'Selection failed')}. Choose it from Preset to try again.`,
              );
            }
          }}
        >
          {(name, change) => (
            <Field label="Preset name" htmlFor="preset-name">
              <input
                id="preset-name"
                maxLength={120}
                required
                value={name}
                onChange={(event) => change(event.target.value)}
              />
            </Field>
          )}
        </FocusedEditor>
      ) : null}
      {management === 'delete' ? (
        <DeleteConfirmDialog
          title="Delete preset?"
          body={
            <>
              <p>
                Choose a preset to delete. Presets used by a bot or conversation
                cannot be deleted.
              </p>
              <PresetSelect
                id="delete-preset"
                label="Preset to delete"
                value={deleteSlug}
                onChange={setDeleteSlug}
              />
            </>
          }
          onClose={() => setManagement(null)}
          onDelete={async () => {
            const document = await getPresetDocument(deleteSlug);
            const result = await deletePreset(deleteSlug, document.revision);
            cache.setQueryData(['presets'], result.presets);
          }}
        />
      ) : null}

      <PresetModels preset={preset} change={change} />

      <PresetFields
        preset={preset}
        patch={patch}
        ttsConfigured={ttsConfigured}
      />
    </AuthoredForm>
  );
}
