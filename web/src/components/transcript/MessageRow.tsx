/**
 * One transcript row: right-aligned user bubble or assistant surface, with a
 * control bar and the shared focused editor. Live output overlays the same
 * assistant row so its disclosure survives completion.
 */
import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  NO_RESPONSE,
  parseScheduledEvent,
  splitSystemError,
} from '@simplebot/shared';
import type { MessagePosition, StoredVariant, Trace } from '@simplebot/shared';

import { errorMessage } from '../../lib/errorMessage.js';
import { cx } from '../../lib/cx.js';
import { formatTime } from '../../lib/format.js';
import { MessageControls } from './MessageControls.js';
import { FocusedEditor } from '../sheets/FocusedEditor.js';
import { ReasoningDisclosure } from './ReasoningDisclosure.js';
import { RoleplayMarkdown } from './RoleplayMarkdown.js';

/** One mutation; its initiating surface owns any failure. */
export type TranscriptUpdate = (
  suffix: string,
  method: 'DELETE' | 'PATCH' | 'POST',
  body?: unknown,
) => Promise<void>;
export type TranscriptAction = (...args: Parameters<TranscriptUpdate>) => void;

/** Streamed presentation for one already admitted assistant position. */
export interface LiveAttempt {
  positionId: string;
  variantId: string;
  text: string;
  trace: Trace;
}

const EFFECT_STATUS: Record<StoredVariant['effects'][number]['state'], string> =
  {
    candidate: 'Pending approval',
    accepted: 'Applying',
    applied: 'Applied',
    failed: 'Failed',
    unresolved: 'Unresolved',
  };

/**
 * Provenance the operator can read.
 *
 * A greeting is stored with the sentinel provenance `authored/greeting` because no
 * provider call produced it — accurate in the database, and storage jargon in
 * a transcript. Everything else names the immutable model without repeating
 * the provider already owned by application configuration.
 */
function provenanceLabel(provider: string, model: string): string {
  return provider === 'authored' ? 'authored greeting' : model;
}

function useCopy(source: string): [boolean, () => void, string | null] {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return [
    copied,
    () => {
      if (source.length === 0) return;
      setCopyError(null);
      setCopied(false);
      // Clipboard access is absent on insecure origins and may be denied.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (navigator.clipboard === undefined) {
        setCopyError(
          'Clipboard unavailable. Select the message text to copy it.',
        );
        return;
      }
      void navigator.clipboard.writeText(source).then(
        () => {
          setCopied(true);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1400);
        },
        (caught: unknown) =>
          setCopyError(
            `Could not copy message: ${errorMessage(caught, 'Clipboard access denied')}`,
          ),
      );
    },
    copyError,
  ];
}

export const UserMessageRow = memo(function UserMessageRow({
  position,
  sessionId,
  update,
  busy,
}: {
  position: Extract<MessagePosition, { role: 'user' }>;
  sessionId: string;
  update: TranscriptUpdate;
  busy: boolean;
}): ReactElement {
  const occurrence = parseScheduledEvent(position.source);
  const scheduled = occurrence !== null;
  const source = scheduled ? occurrence.prompt : position.source;
  const [editing, setEditing] = useState(false);
  const [copied, copy, copyError] = useCopy(source);

  return (
    <article className={cx('msg-row', 'is-user', scheduled && 'is-scheduled')}>
      <div className="msg-surface">
        {occurrence === null ? null : (
          <p className="msg-occurrence">
            <span className="msg-occurrence-name">{occurrence.name}</span>
            <span className="msg-occurrence-time">
              {formatTime(occurrence.ranAt)}
            </span>
          </p>
        )}
        {source.length === 0 ? null : (
          /*
           * Operator text renders verbatim. The bubble is a solid accent
           * fill, so syntax colors meant for prose on the page background
           * fight it; and source punctuation must remain intact.
           */
          <p className="msg-plain">{source}</p>
        )}
        {position.attachments.length > 0 ? (
          <ul className="msg-attachments" aria-label="Attachments">
            {position.attachments.map((item) => (
              <li key={item.id}>
                <img
                  src={`/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(item.id)}`}
                  alt={item.filename}
                  width={item.width}
                  height={item.height}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {copyError === null ? null : (
        <p className="ui-notice" role="alert">
          {copyError}
        </p>
      )}
      {editing ? (
        <FocusedEditor
          title="Edit your message"
          value={position.source}
          actionLabel="Save message changes"
          valid={(draft) => draft.trim().length > 0}
          onClose={() => setEditing(false)}
          onSave={(source) =>
            update(`/positions/${position.id}/source`, 'PATCH', { source })
          }
        >
          {(draft, change) => (
            <textarea
              aria-label="Edit your message"
              value={draft}
              onChange={(event) => change(event.target.value)}
            />
          )}
        </FocusedEditor>
      ) : null}
      {scheduled ? null : (
        <MessageControls
          role="user"
          createdAt={position.createdAt}
          copied={copied}
          busy={busy}
          onCopy={copy}
          onEdit={() => {
            setEditing(true);
          }}
        />
      )}
    </article>
  );
});

function EffectList({
  variant,
  onAction,
}: {
  variant: StoredVariant;
  onAction: TranscriptAction;
}): ReactElement | null {
  if (variant.effects.length === 0) return null;
  return (
    <ol className="msg-effects" aria-label="Response effects">
      {variant.effects.map((effect) => (
        <li key={effect.id} className={`is-${effect.state}`}>
          <span className="msg-effect-name">{effect.type}</span>
          <span className="msg-effect-status">
            {EFFECT_STATUS[effect.state]}
          </span>
          <code>{JSON.stringify(effect.arguments)}</code>
          {effect.result === null ? null : <code>{effect.result}</code>}
          {effect.state === 'unresolved' ? (
            <button
              type="button"
              className="ui-button is-small is-quiet"
              onClick={() => {
                onAction(`/effects/${effect.id}/resolve`, 'POST');
              }}
            >
              Mark resolved
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export const AssistantMessageRow = memo(function AssistantMessageRow({
  position,
  live = null,
  sessionId,
  ttsConfigured,
  botName,
  update,
  onAction,
  regenerate,
  busy,
}: {
  position: Extract<MessagePosition, { role: 'assistant' }> | null;
  live?: LiveAttempt | null;
  sessionId: string;
  ttsConfigured: boolean;
  botName: string;
  update: TranscriptUpdate;
  onAction: TranscriptAction;
  regenerate: (positionId: string) => void;
  busy: boolean;
}): ReactElement {
  // The server resolves and counts the siblings; the row only renders one.
  const variant = position?.variant;
  const [edit, setEdit] = useState<Pick<StoredVariant, 'id' | 'source'> | null>(
    null,
  );
  const rendered = splitSystemError(live?.text ?? variant?.source ?? '');
  const source =
    rendered.content === NO_RESPONSE ? '_No response_' : rendered.content;
  const [copied, copy, copyError] = useCopy(variant?.source ?? '');

  return (
    <article
      className={cx('msg-row', 'is-assistant', live !== null && 'is-live')}
      aria-live={live !== null ? 'polite' : undefined}
    >
      <div className="msg-surface">
        <ReasoningDisclosure
          key={live?.variantId ?? variant?.id}
          trace={live?.trace ?? variant?.trace ?? []}
          streaming={live !== null}
        />
        {live !== null && source.length === 0 ? (
          <p className="msg-live-status">Responding…</p>
        ) : source.length === 0 ? null : (
          <RoleplayMarkdown source={source} />
        )}
        {rendered.error === null ? null : (
          <p className="ui-hint is-error" role="status">
            {rendered.error}
          </p>
        )}
        {live === null && variant !== undefined ? (
          <EffectList variant={variant} onAction={onAction} />
        ) : null}
      </div>
      {live === null && position !== null && variant !== undefined ? (
        <>
          {copyError === null ? null : (
            <p className="ui-notice" role="alert">
              {copyError}
            </p>
          )}
          {edit === null ? null : (
            <FocusedEditor
              title={`Edit ${botName}'s message`}
              value={edit.source}
              actionLabel="Save message changes"
              valid={(draft) => draft.trim().length > 0}
              onClose={() => setEdit(null)}
              onSave={(source) =>
                update(`/variants/${edit.id}/source`, 'PATCH', { source })
              }
            >
              {(draft, change) => (
                <textarea
                  aria-label={`Edit ${botName}'s message`}
                  value={draft}
                  onChange={(event) => change(event.target.value)}
                />
              )}
            </FocusedEditor>
          )}
          <MessageControls
            role="assistant"
            createdAt={variant.createdAt}
            provenance={provenanceLabel(variant.provider, variant.model)}
            swipe={
              position.locked
                ? null
                : {
                    index: position.variantIndex,
                    count: position.variantCount,
                    onPrevious: () => {
                      onAction(`/positions/${position.id}/selection`, 'PATCH', {
                        direction: 'previous',
                      });
                    },
                    onNext: () => {
                      onAction(`/positions/${position.id}/selection`, 'PATCH', {
                        direction: 'next',
                      });
                    },
                    onGenerate: () => {
                      regenerate(position.id);
                    },
                    ...(variant.provider === 'authored'
                      ? {
                          generateDisabledReason:
                            'Starting greetings are authored in the Bot panel',
                        }
                      : {}),
                    onDelete: () => update(`/variants/${variant.id}`, 'DELETE'),
                  }
            }
            speech={
              ttsConfigured && rendered.error === null
                ? { sessionId, variantId: variant.id }
                : null
            }
            onApplyEffects={
              variant.effects.some((effect) => effect.state === 'candidate')
                ? () => {
                    onAction(`/positions/${position.id}/accept`, 'POST');
                  }
                : null
            }
            copied={copied}
            busy={busy}
            onCopy={copy}
            onEdit={() => {
              setEdit({ id: variant.id, source: variant.source });
            }}
          />
        </>
      ) : null}
    </article>
  );
});
