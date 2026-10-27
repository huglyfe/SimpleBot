import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '../../lib/errorMessage.js';
import { cx } from '../../lib/cx.js';
import { useDialog } from '../../lib/focus.js';

export interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pendingLabel?: string;
  dismissible?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  initialFocus?: 'cancel' | 'first-field';
  returnFocus?: (() => HTMLElement | null | undefined) | undefined;
  cancelLabel?: string;
  secondaryAction?: {
    label: string;
    onClick: () => void | Promise<void>;
    destructive?: boolean;
  };
}

/** One confirmation owns its action, pending controls, and failure. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  pendingLabel = confirmLabel,
  dismissible = true,
  onConfirm,
  onCancel,
  initialFocus = 'cancel',
  cancelLabel = 'Cancel',
  returnFocus,
  secondaryAction,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm(action = onConfirm) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not complete action.'));
    } finally {
      setPending(false);
    }
  }
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const dialog = useDialog({
    onDismiss: onCancel,
    returnFocus,
    dismissible: dismissible && !pending,
    initialFocus: (dialog) =>
      !dismissible
        ? dialog.querySelector<HTMLElement>('button')
        : initialFocus === 'first-field'
          ? dialog.querySelector<HTMLElement>('input, textarea, select')
          : cancelRef.current,
  });

  return createPortal(
    <dialog
      {...dialog}
      className="ui-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <h2 className="ui-dialog-title" id={titleId}>
        {title}
      </h2>
      <fieldset className="ui-dialog-body" id={bodyId} disabled={pending}>
        {body}
        {error !== null ? (
          <p className="ui-hint is-error" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <div className="ui-dialog-footer">
        {dismissible ? (
          <button
            ref={cancelRef}
            type="button"
            className="ui-button"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </button>
        ) : null}
        {secondaryAction ? (
          <button
            type="button"
            className={cx(
              'ui-button',
              secondaryAction.destructive && 'is-danger',
            )}
            onClick={() => void confirm(secondaryAction.onClick)}
            disabled={pending}
          >
            {secondaryAction.label}
          </button>
        ) : null}
        <button
          type="button"
          className={cx('ui-button', destructive ? 'is-danger' : 'is-primary')}
          onClick={() => void confirm()}
          disabled={pending}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
