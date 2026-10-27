import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  botGreetings,
  capabilityIdentity,
  type BotSource,
  type Bootstrap,
  type CapabilityCatalog,
  type BotCapability,
} from '@simplebot/shared';

import {
  getBotDocument,
  getCapabilities,
  replaceBotArtwork,
} from '../../api.js';
import { errorMessage } from '../../lib/errorMessage.js';
import { FileButton } from '../primitives/FileButton.js';
import { Avatar } from '../primitives/Avatar.js';
import { BotCapabilities } from './BotCapabilities.js';
import { PresetSelect } from './PresetSelect.js';
import { Field } from '../primitives/Field.js';
import { Sheet } from '../primitives/Sheet.js';
import { BotWriting, BotGreetings } from './BotWriting.js';
import { AuthoredForm } from './AuthoredForm.js';
import { Section } from './Section.js';
import { useAuthoredEditor, type AuthoredQuery } from './useAuthoredEditor.js';

type SaveDocument = (
  path: string,
  value: Record<string, unknown>,
  revision: string,
) => Promise<string>;

export function BotSheet({
  slug,
  artworkUrl,
  save,
}: {
  slug: string;
  artworkUrl: string | null;
  save: SaveDocument;
}): ReactElement {
  const cardPath = `bots/${encodeURIComponent(slug)}`;
  const card = useQuery({
    queryKey: ['authored', cardPath],
    queryFn: () => getBotDocument(slug),
  });
  const catalog = useQuery({
    queryKey: ['capabilities'],
    queryFn: getCapabilities,
  });
  if (card.data === undefined) {
    const error = card.error;
    return error === null ? (
      <p className="ui-empty">Loading bot…</p>
    ) : (
      <p className="ui-notice" role="alert">
        {error.message}
      </p>
    );
  }

  return (
    <BotEditor
      slug={slug}
      cardPath={cardPath}
      card={card}
      artworkUrl={artworkUrl}
      catalog={catalog.data ?? null}
      catalogError={catalog.isError ? catalog.error.message : null}
      save={save}
    />
  );
}

function BotEditor({
  slug,
  cardPath,
  card,
  artworkUrl,
  catalog,
  catalogError,
  save,
}: {
  slug: string;
  cardPath: string;
  card: AuthoredQuery<BotSource>;
  artworkUrl: string | null;
  catalog: CapabilityCatalog | null;
  catalogError: string | null;
  save: SaveDocument;
}): ReactElement {
  const cache = useQueryClient();
  const artwork = useMutation({
    mutationFn: (file: File) => replaceBotArtwork(slug, file),
    onSuccess: async (avatarUrl) => {
      await cache.cancelQueries({ queryKey: ['bootstrap'] });
      cache.setQueryData<Bootstrap>(
        ['bootstrap'],
        (current) =>
          current && {
            ...current,
            bots: current.bots.map((bot) =>
              bot.slug === slug ? { ...bot, avatarUrl } : bot,
            ),
          },
      );
    },
  });
  const cardEditor = useAuthoredEditor({
    query: card,
    save: async (value, revision) => ({
      value,
      revision: await save(cardPath, value, revision),
    }),
  });
  const cardData = cardEditor.value.data;
  const settings = cardData.extensions?.simplebot ?? {};
  const greetings = botGreetings(cardEditor.value);
  const selectedPreset = settings.defaultPreset ?? '';
  const [artworkOpen, setArtworkOpen] = useState(false);
  const selectedCapabilities = settings.capabilities ?? [];
  const selectedMemory =
    selectedCapabilities.find((capability) => capability.kind === 'memory') ??
    null;
  const memoryCatalog = (catalog?.capabilities ?? []).filter(
    (capability) => capability.kind === 'memory',
  );
  const known = new Set((catalog?.capabilities ?? []).map(capabilityIdentity));
  const memoryOptions = [
    { value: '', label: 'None' },
    ...memoryCatalog.map((capability) => ({
      value: capability.dependency,
      label: `${capability.dependency} — ${
        capability.available
          ? capability.retains
            ? 'Available, recalls and retains accepted turns'
            : 'Available, read-only recall'
          : 'Unavailable'
      }`,
    })),
  ];
  if (
    selectedMemory !== null &&
    !known.has(capabilityIdentity(selectedMemory))
  ) {
    memoryOptions.push({
      value: selectedMemory.dependency,
      label: `${selectedMemory.dependency} — ${
        catalog?.dependencies.some(
          (entry) =>
            entry.kind === 'memory' && entry.name === selectedMemory.dependency,
        )
          ? 'Unavailable'
          : 'No longer configured'
      }`,
    });
  }
  const botName = cardData.name || slug;
  function patchCard(patch: Partial<BotSource['data']>): void {
    cardEditor.change((current) => ({
      ...current,
      data: { ...current.data, ...patch },
    }));
  }
  function patchSettings(next: typeof settings): void {
    patchCard({ extensions: { ...cardData.extensions, simplebot: next } });
  }

  function selectMemory(dependency: string): void {
    patchSettings({
      ...settings,
      capabilities: [
        ...selectedCapabilities.filter((entry) => entry.kind !== 'memory'),
        ...(dependency === ''
          ? []
          : [{ kind: 'memory', dependency } satisfies BotCapability]),
      ],
    });
  }

  return (
    <AuthoredForm
      {...cardEditor}
      disabled={cardEditor.saving || artwork.isPending}
      onSave={() => cardEditor.update()}
    >
      <section className="settings-section">
        <div className="bot-card">
          {artworkUrl === null ? (
            <Avatar name={botName} artworkUrl={null} size={72} />
          ) : (
            <button
              type="button"
              className="bot-artwork-trigger"
              aria-label={`View ${botName} artwork`}
              onClick={() => setArtworkOpen(true)}
            >
              <img src={artworkUrl} alt="" width={72} height={108} />
            </button>
          )}
          <div className="bot-card-details">
            <Field label="Name" htmlFor="card-name" hideLabel>
              <input
                id="card-name"
                placeholder="Bot name"
                value={cardData.name}
                onChange={(event) => patchCard({ name: event.target.value })}
              />
            </Field>
            <div className="bot-file-action">
              <FileButton
                label={artworkUrl === null ? 'Add image' : 'Change image'}
                accept="image/png,.png"
                onSelect={(file) => artwork.mutate(file)}
              />
              <span className="ui-hint" role="status">
                {artwork.isPending ? 'Uploading image…' : 'Saves immediately.'}
              </span>
            </div>
            {artwork.isError ? (
              <p className="ui-notice" role="alert">
                {errorMessage(artwork.error, 'Could not replace image')}
              </p>
            ) : null}
          </div>
        </div>
        <PresetSelect
          id="config-preset"
          label="Default preset"
          value={selectedPreset}
          onChange={(slug) =>
            patchSettings({
              ...settings,
              defaultPreset: slug,
            })
          }
        />

        {catalog !== null ? (
          <Field label="Memory server" htmlFor="bot-memory">
            <select
              id="bot-memory"
              value={selectedMemory?.dependency ?? ''}
              onChange={(event) => selectMemory(event.target.value)}
            >
              {memoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </section>

      <BotCapabilities
        catalog={catalog}
        error={catalogError}
        value={selectedCapabilities}
        onChange={(capabilities) =>
          patchSettings({ ...settings, capabilities })
        }
      />

      <BotWriting cardData={cardData} patchCard={patchCard} />

      <Section title="Greetings">
        <BotGreetings
          values={greetings}
          onChange={(values) =>
            patchCard({
              first_mes: values[0] ?? '',
              alternate_greetings: values.slice(1),
            })
          }
        />
      </Section>

      {artworkOpen && artworkUrl !== null ? (
        <Sheet
          label={`${botName} artwork`}
          title={`${botName} artwork`}
          placement="center"
          onClose={() => setArtworkOpen(false)}
        >
          <div className="bot-artwork-viewer">
            <img src={artworkUrl} alt={`${botName} artwork`} />
          </div>
        </Sheet>
      ) : null}
    </AuthoredForm>
  );
}
