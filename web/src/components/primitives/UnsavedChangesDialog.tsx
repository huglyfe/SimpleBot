import { ConfirmDialog } from './ConfirmDialog.js';

/** Continue only after saving successfully or explicitly discarding the draft. */
export function UnsavedChangesDialog({
  onSave,
  onContinue,
  onCancel,
}: {
  onSave: () => Promise<void>;
  onContinue: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      title="Unsaved changes"
      body="Save your changes before leaving? Discard removes unsaved changes."
      confirmLabel="Save"
      pendingLabel="Working…"
      onCancel={onCancel}
      onConfirm={async () => {
        await onSave();
        await onContinue();
      }}
      secondaryAction={{
        label: 'Discard',
        destructive: true,
        onClick: onContinue,
      }}
    />
  );
}
