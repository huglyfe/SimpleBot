/**
 * Presentational rows above the composer pill: blocking alerts and the staged
 * file thumbnail strip. All state lives in Composer.tsx; these only render and
 * report.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { CloseIcon } from '../../icons.js';
import { stagedKey } from './drafts.js';

/** Danger row for attempt failures and send errors. */
export function ComposerAlert({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div className="ui-notice" role="alert">
      <p className="composer-alert-text">{message}</p>
      <button
        type="button"
        className="composer-notice-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/**
 * Horizontally scrolling strip of staged-file thumbnails. Object URLs are
 * revoked when the strip's file set changes, so staging and unstaging in a
 * long session cannot leak them.
 */
export function StagedFileStrip({
  files,
  disabled = false,
  onRemove,
}: {
  files: File[];
  /** The turn has been submitted: it stays visible but cannot be changed. */
  disabled?: boolean;
  onRemove: (file: File) => void;
}): ReactElement {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const file of files) next[stagedKey(file)] = URL.createObjectURL(file);
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [files]);

  return (
    <div
      className="composer-staged ui-scrollbar"
      role="group"
      aria-label="Staged images"
    >
      {files.map((file) => {
        const url = urls[stagedKey(file)];
        return (
          <div className="composer-thumb" key={stagedKey(file)}>
            {url === undefined ? null : <img src={url} alt={file.name} />}
            <button
              type="button"
              className="ui-icon-button is-danger composer-thumb-remove"
              aria-label={`Remove ${file.name}`}
              disabled={disabled}
              onClick={() => {
                onRemove(file);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
