/** Transcript actions remain stable while the shared editor is open. */
import { useState, type ReactElement } from 'react';

import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  EditIcon,
  RefreshIcon,
  TrashIcon,
} from '../../icons.js';
import { formatTime, useTimePreferences } from '../../lib/format.js';
import { ConfirmDialog } from '../primitives/ConfirmDialog.js';
import { IconButton } from '../primitives/IconButton.js';
import { MessageSpeechControl } from './MessageSpeechControl.js';

export interface SwipeControls {
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
  onGenerate: () => void;
  generateDisabledReason?: string;
  onDelete: () => Promise<void>;
}

export interface MessageControlsProps {
  role: 'assistant' | 'user';
  createdAt: string;
  /** Immutable model label for an assistant variant. */
  provenance?: string | null;
  swipe?: SwipeControls | null;
  speech?: { sessionId: string; variantId: string } | null;
  /** Shown only when the variant holds effects awaiting acceptance. */
  onApplyEffects?: (() => void) | null;
  copied: boolean;
  /** True while an attempt is running: mutation controls stand down. */
  busy: boolean;
  onCopy: () => void;
  onEdit: () => void;
}

const BUSY_REASON = 'Unavailable while the conversation is changing';

export function MessageControls({
  role,
  createdAt,
  provenance = null,
  swipe = null,
  speech = null,
  onApplyEffects = null,
  copied,
  busy,
  onCopy,
  onEdit,
}: MessageControlsProps): ReactElement {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const time = useTimePreferences();
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  const swipeDisabledReason = busy ? BUSY_REASON : undefined;
  const canDeleteSwipe = swipe !== null && swipe.count > 1 && !busy;

  const leadingControls =
    swipe === null ? null : (
      <span
        className="msg-control-group msg-swipe-controls"
        role="group"
        aria-label="Response variants"
      >
        <IconButton
          label="Previous variant"
          disabled={busy || swipe.index <= 0}
          disabledReason={
            swipe.index <= 0 && !busy
              ? 'No previous variant'
              : swipeDisabledReason
          }
          onClick={swipe.onPrevious}
        >
          <ChevronLeftIcon />
        </IconButton>
        <span
          className="msg-swipe-position"
          aria-label={`Variant ${String(swipe.index + 1)} of ${String(swipe.count)}`}
        >
          {swipe.index + 1}/{swipe.count}
        </span>
        {swipe.index < swipe.count - 1 ? (
          <IconButton
            label="Next variant"
            disabled={busy}
            disabledReason={swipeDisabledReason}
            onClick={swipe.onNext}
          >
            <ChevronRightIcon />
          </IconButton>
        ) : (
          <IconButton
            label="Generate another reply"
            disabled={busy || swipe.generateDisabledReason !== undefined}
            disabledReason={swipe.generateDisabledReason ?? swipeDisabledReason}
            onClick={swipe.onGenerate}
          >
            <RefreshIcon />
          </IconButton>
        )}
      </span>
    );

  return (
    <>
      <footer className={`msg-footer${role === 'user' ? ' is-user' : ''}`}>
        {leadingControls}
        <span className="msg-time">{formatTime(createdAt, time)}</span>
        {provenance === null ? null : (
          <button
            type="button"
            className={`msg-model${provenanceOpen ? ' is-expanded' : ''}`}
            aria-expanded={provenanceOpen}
            aria-label={`Response from ${provenance}`}
            /* Truncation is what a pointer can already resolve without
               spending the tap that touch has to spend. */
            title={provenance}
            onClick={() => setProvenanceOpen((open) => !open)}
          >
            {provenance}
          </button>
        )}
        <span className="msg-controls-spacer" />
        <span className="msg-control-group">
          {speech === null ? null : (
            <MessageSpeechControl
              key={speech.variantId}
              sessionId={speech.sessionId}
              variantId={speech.variantId}
              disabled={busy}
            />
          )}
          {canDeleteSwipe ? (
            <IconButton
              label="Delete swipe"
              danger
              onClick={() => setConfirmingDelete(true)}
            >
              <TrashIcon />
            </IconButton>
          ) : null}
          {onApplyEffects === null ? null : (
            <IconButton
              label="Apply effects"
              disabled={busy}
              disabledReason={busy ? BUSY_REASON : undefined}
              onClick={onApplyEffects}
            >
              <CheckIcon />
            </IconButton>
          )}
          <IconButton label="Copy message text" onClick={onCopy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </IconButton>
          <IconButton
            label="Edit message"
            disabled={busy}
            disabledReason={busy ? BUSY_REASON : undefined}
            onClick={onEdit}
          >
            <EditIcon />
          </IconButton>
        </span>
      </footer>
      {confirmingDelete && swipe !== null ? (
        <ConfirmDialog
          title={`Delete swipe ${String(swipe.index + 1)} of ${String(swipe.count)}?`}
          body={<p>An adjacent swipe becomes the reply.</p>}
          confirmLabel="Delete swipe"
          destructive
          pendingLabel="Deleting…"
          onConfirm={async () => {
            await swipe.onDelete();
            setConfirmingDelete(false);
          }}
          onCancel={() => {
            setConfirmingDelete(false);
          }}
        />
      ) : null}
    </>
  );
}
