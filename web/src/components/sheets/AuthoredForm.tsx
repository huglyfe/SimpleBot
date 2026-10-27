import {
  useId,
  type RefObject,
  type ReactElement,
  type ReactNode,
} from 'react';
import { CloseIcon, SaveIcon } from '../../icons.js';
import { SheetActions, useSheetEditor } from '../primitives/Sheet.js';
import { IconButton } from '../primitives/IconButton.js';

/** Failed writes stay visible; stale files require an explicit fresh read. */
export function AuthoredForm({
  form,
  discard,
  actions,
  error,
  conflict,
  saving,
  reloadLatest,
  changed = false,
  onSave,
  disabled = saving,
  children,
}: {
  children: ReactNode;
  form: RefObject<HTMLFormElement | null>;
  discard: () => void;
  actions?: ReactNode;
  disabled?: boolean;
  changed?: boolean;
  onSave: () => Promise<void>;
  error: string | null;
  conflict: boolean;
  saving: boolean;
  reloadLatest: () => Promise<void>;
}): ReactElement {
  const formId = useId();
  function focusClose() {
    form.current
      ?.closest('[role="dialog"]')
      ?.querySelector<HTMLElement>('[aria-label="Close panel"]')
      ?.focus({ preventScroll: true });
  }
  useSheetEditor({ busy: disabled, dirty: changed, save: onSave });
  return (
    <form
      id={formId}
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled || !changed) return;
        focusClose();
        void onSave().catch(() => undefined);
      }}
    >
      <SheetActions>
        {actions}
        <IconButton
          label="Discard"
          danger
          disabled={!changed || disabled}
          onClick={() => {
            focusClose();
            discard();
          }}
        >
          <CloseIcon />
        </IconButton>
        <button
          type="submit"
          form={formId}
          className="ui-button is-primary ui-editor-action"
          aria-label={saving ? 'Saving…' : 'Save'}
          title="Save"
          disabled={!changed || disabled}
        >
          <SaveIcon />
          Save
        </button>
      </SheetActions>
      <fieldset className="settings-group" inert={disabled}>
        {children}
      </fieldset>
      {error === null ? null : (
        <p className="ui-notice" role="alert">
          {error}
        </p>
      )}
      {conflict ? (
        <button
          type="button"
          className="ui-button"
          disabled={saving}
          onClick={() => void reloadLatest()}
        >
          Reload latest
        </button>
      ) : null}
    </form>
  );
}
