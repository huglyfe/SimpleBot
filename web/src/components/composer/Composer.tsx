import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import { ArrowUpIcon, PlusIcon, StopIcon } from '../../icons.js';
import { IconButton } from '../primitives/IconButton.js';
import { ComposerAlert, StagedFileStrip } from './ComposerNotices.js';
import {
  ACCEPTED_IMAGE_MIMES,
  MAX_STAGED_FILES,
  acceptFiles,
  getDraft,
  saveDraft,
  stagedKey,
} from './drafts.js';

const TEXTAREA_MAX_HEIGHT = 180;

export interface ComposerProps {
  sessionId: string;
  botName: string;
  generating: boolean;
  error: string | null;
  onDismissError: () => void;
  /** `admit` transfers the exact draft and staged files to the transcript. */
  onSend: (text: string, files: File[], admit: () => void) => Promise<void>;
  onStop: () => void;
}

export function Composer({
  sessionId,
  botName,
  generating,
  error,
  onDismissError,
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const zone = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = zone.current;
    const conversation = element?.parentElement;
    if (!element || !conversation) return;
    const measure = () =>
      conversation.style.setProperty(
        '--ui-composer-height',
        `${String(element.getBoundingClientRect().height)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      conversation.style.removeProperty('--ui-composer-height');
    };
  }, []);
  const [draft, setDraft] = useState(() => getDraft(sessionId)?.draft ?? '');
  const [files, setFiles] = useState<File[]>(
    () => getDraft(sessionId)?.files ?? [],
  );
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = 'auto';
    element.style.height = `${String(Math.min(element.scrollHeight, TEXTAREA_MAX_HEIGHT))}px`;
  }, [draft]);

  function updateDraft(next: string): void {
    setDraft(next);
    saveDraft(sessionId, next, files);
  }

  function updateFiles(next: File[]): void {
    setFiles(next);
    saveDraft(sessionId, draft, next);
  }

  function admit(): void {
    setDraft('');
    setFiles([]);
    saveDraft(sessionId, '', []);
  }

  function submit(): void {
    const text = draft.trim();
    if (text === '' || generating) return;
    void onSend(text, files, admit).catch(() => undefined);
  }

  const stagedFull = files.length >= MAX_STAGED_FILES;

  return (
    <div ref={zone} className="composer-zone">
      {error === null ? null : (
        <ComposerAlert message={error} onDismiss={onDismissError} />
      )}
      <div className="composer">
        {files.length === 0 ? null : (
          <StagedFileStrip
            files={files}
            disabled={generating}
            onRemove={(file) => {
              updateFiles(
                files.filter((item) => stagedKey(item) !== stagedKey(file)),
              );
            }}
          />
        )}
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          tabIndex={-1}
          aria-label="Choose images"
          accept={ACCEPTED_IMAGE_MIMES.join(',')}
          multiple
          onChange={(event) => {
            const chosen = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = '';
            updateFiles(acceptFiles(files, chosen));
          }}
        />
        <div className="composer-entry">
          <textarea
            ref={textarea}
            aria-label="Message"
            rows={1}
            placeholder={`Message ${botName}`}
            disabled={generating}
            value={draft}
            onKeyDown={(event) => {
              if (
                event.key !== 'Enter' ||
                !(event.metaKey || event.ctrlKey) ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              if (!event.repeat) submit();
            }}
            onChange={(event) => {
              updateDraft(event.target.value);
            }}
          />
          <div className="composer-actions">
            <IconButton
              label="Add images"
              title={
                stagedFull
                  ? `Up to ${String(MAX_STAGED_FILES)} images`
                  : 'Add images'
              }
              disabled={stagedFull || generating}
              disabledReason={
                stagedFull
                  ? `Up to ${String(MAX_STAGED_FILES)} images`
                  : undefined
              }
              onClick={() => fileInput.current?.click()}
            >
              <PlusIcon />
            </IconButton>
            {generating ? (
              <button
                key="stop"
                type="button"
                className="send-button is-stop"
                aria-label="Stop response"
                onClick={onStop}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                key="send"
                type="button"
                className="send-button"
                aria-label="Send message"
                aria-keyshortcuts="Meta+Enter Control+Enter"
                title="Send message (⌘ Enter / Ctrl Enter)"
                disabled={draft.trim() === ''}
                onClick={submit}
              >
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
