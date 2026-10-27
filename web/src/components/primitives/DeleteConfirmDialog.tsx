import { type ReactNode } from 'react';

import { ConfirmDialog } from './ConfirmDialog.js';

/** Mount for one deletion target; keep failures beside the explicit action. */
export function DeleteConfirmDialog({
  title,
  body,
  onDelete,
  onClose,
  returnFocus,
}: {
  title: string;
  body: ReactNode;
  onDelete: () => Promise<void>;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  return (
    <ConfirmDialog
      title={title}
      returnFocus={returnFocus}
      body={body}
      confirmLabel="Delete"
      pendingLabel="Deleting…"
      destructive
      onConfirm={async () => {
        await onDelete();
        onClose();
      }}
      onCancel={onClose}
    />
  );
}
