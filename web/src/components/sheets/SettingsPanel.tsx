/**
 * One sheet per owner.
 *
 * Providers and Application edit root settings. Bot and Preset each
 * save their authored document. Capabilities keeps its root dependency settings
 * separate from bot-owned selections.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { Bootstrap } from '@simplebot/shared';

import {
  getSettings,
  saveAuthoredDocument,
  saveSettings,
  setSessionPreset,
} from '../../api.js';
import { useTheme } from '../../theme/theme.js';
import { Sheet, type SheetPlacement } from '../primitives/Sheet.js';
import { ApplicationSheet } from './ApplicationSheet.js';
import { CapabilitiesSheet } from './CapabilitiesSheet.js';
import { BotSheet } from './BotSheet.js';
import { ConversationSheet } from './ConversationSheet.js';
import { PresetSheet } from './PresetSheet.js';
import { ProviderSheet } from './ProviderSheet.js';
import { AuthoredForm } from './AuthoredForm.js';
import { useAuthoredEditor, type AuthoredQuery } from './useAuthoredEditor.js';

export type PanelSection =
  | 'bot'
  | 'conversation'
  | 'preset'
  | 'providers'
  | 'capabilities'
  | 'application';

export type Panel =
  { section: 'bot'; slug: string } | { section: Exclude<PanelSection, 'bot'> };

const TITLES: Record<PanelSection, string> = {
  bot: 'Bot',
  conversation: 'Conversation controls',
  preset: 'Preset',
  providers: 'Providers & Keys',
  capabilities: 'Capabilities',
  application: 'Application',
};

type RootPanelSection = 'providers' | 'application';

/** Panels backed by `config.json` and therefore by the shared revision boundary. */
function isRootPanel(section: PanelSection): section is RootPanelSection {
  return section === 'providers' || section === 'application';
}

/**
 * A panel arrives from where its control is. Preset is the header's
 * right-hand conversation control, so it stays a side sheet. Bot is
 * the identity above the transcript, so it drops from the top. The drawer's
 * application settings belong to no edge and open centered.
 */
const PLACEMENTS: Record<PanelSection, SheetPlacement> = {
  bot: 'top',
  conversation: 'side',
  preset: 'side',
  providers: 'center',
  capabilities: 'center',
  application: 'center',
};

export function SettingsPanel({
  panel,
  bots,
  version,
  ttsConfigured,
  session,
  onClose,
  returnFocus,
}: {
  panel: Panel;
  bots: Bootstrap['bots'];
  version: string;
  ttsConfigured: boolean;
  session: Bootstrap['sessions'][number] | undefined;
  onClose: () => void;
  returnFocus?: (() => HTMLElement | null) | undefined;
}): ReactElement {
  const section = panel.section;
  const cache = useQueryClient();
  const usesRoot = isRootPanel(section);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    enabled: usesRoot,
  });
  /** Authored writes go through the same cache the sheets read from. */
  async function saveAuthored(
    path: string,
    next: Record<string, unknown>,
    revision: string,
  ): Promise<string> {
    const nextRevision = await saveAuthoredDocument(path, next, revision);
    cache.setQueryData(['authored', path], {
      value: next,
      revision: nextRevision,
    });
    void cache.invalidateQueries({
      queryKey: path.startsWith('presets/') ? ['presets'] : ['bootstrap'],
    });
    return nextRevision;
  }

  const activePreset = session?.presetSlug ?? null;
  return (
    <Sheet
      label={
        section === 'conversation'
          ? TITLES[section]
          : `${TITLES[section]} settings`
      }
      title={TITLES[section]}
      width={560}
      placement={PLACEMENTS[section]}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {usesRoot && settings.isPending ? (
        <p className="ui-empty">Loading settings…</p>
      ) : null}
      {usesRoot && settings.isError ? (
        <p className="ui-notice" role="alert">
          {settings.error.message}
        </p>
      ) : null}

      {usesRoot && settings.data !== undefined ? (
        <RootSettingsEditor
          section={section}
          version={version}
          query={settings}
        />
      ) : null}

      {section === 'capabilities' ? <CapabilitiesSheet /> : null}

      {section === 'conversation' ? (
        session === undefined ? (
          <p className="ui-empty">No conversation selected.</p>
        ) : (
          <ConversationSheet sessionId={session.id} />
        )
      ) : null}

      {panel.section === 'bot' ? (
        <BotSheet
          key={panel.slug}
          slug={panel.slug}
          artworkUrl={
            bots.find((bot) => bot.slug === panel.slug)?.avatarUrl ?? null
          }
          save={saveAuthored}
        />
      ) : null}

      {section === 'preset' ? (
        activePreset === null ? (
          <p className="ui-empty">No conversation selected.</p>
        ) : (
          <PresetSheet
            slug={activePreset}
            onSelectPreset={async (presetSlug) => {
              if (!session) return;
              await setSessionPreset(session.id, presetSlug);
              cache.setQueryData<Bootstrap>(
                ['bootstrap'],
                (current) =>
                  current && {
                    ...current,
                    sessions: current.sessions.map((entry) =>
                      entry.id === session.id
                        ? { ...entry, presetSlug }
                        : entry,
                    ),
                  },
              );
              void cache.invalidateQueries({
                queryKey: ['session', session.id],
              });
              void cache.invalidateQueries({
                queryKey: ['context', session.id],
              });
            }}
            save={saveAuthored}
            ttsConfigured={ttsConfigured}
          />
        )
      ) : null}
    </Sheet>
  );
}

function RootSettingsEditor({
  section,
  version,
  query,
}: {
  section: RootPanelSection;
  version: string;
  query: AuthoredQuery<Awaited<ReturnType<typeof getSettings>>['value']>;
}): ReactElement {
  const cache = useQueryClient();
  const { appearance, setAppearance } = useTheme();
  const [draftAppearance, setDraftAppearance] = useState(appearance);
  const editor = useAuthoredEditor({
    query,
    save: async (value, revision) => {
      const next = {
        value,
        revision: await saveSettings(value, revision),
      };
      cache.setQueryData(['settings'], next);
      void cache.invalidateQueries({
        queryKey: ['dependencies'],
        refetchType: 'none',
      });
      void Promise.all([
        cache.invalidateQueries({ queryKey: ['bootstrap'] }),
        ...(section === 'application'
          ? [cache.invalidateQueries({ queryKey: ['context'] })]
          : []),
        ...(section === 'providers'
          ? [cache.invalidateQueries({ queryKey: ['provider-models'] })]
          : []),
      ]);
      return next;
    },
  });
  function patch(key: string, value: unknown): void {
    editor.change((current) => ({ ...current, [key]: value }));
  }

  return (
    <AuthoredForm
      {...editor}
      changed={editor.changed || draftAppearance !== appearance}
      discard={() => {
        editor.discard();
        setDraftAppearance(appearance);
      }}
      onSave={async () => {
        await editor.update();
        if (draftAppearance !== appearance) setAppearance(draftAppearance);
      }}
    >
      {section === 'providers' ? (
        <ProviderSheet
          value={editor.value}
          saved={editor.savedValue.providers}
          patch={patch}
        />
      ) : (
        <ApplicationSheet
          value={editor.value}
          patch={patch}
          version={version}
          appearance={draftAppearance}
          onAppearanceChange={setDraftAppearance}
        />
      )}
    </AuthoredForm>
  );
}
