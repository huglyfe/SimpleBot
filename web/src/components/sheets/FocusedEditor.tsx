import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, RefreshIcon, SaveIcon } from '../../icons.js';
import { Sheet, SheetActions } from '../primitives/Sheet.js';
import { errorMessage } from '../../lib/errorMessage.js';

export function FocusedEditor<T>({
  title,
  value,
  onSave,
  onClose,
  actionLabel = 'Save',
  returnFocus,
  valid = () => true,
  children,
}: {
  title: string;
  value: T;
  onSave: (draft: T) => void | Promise<void>;
  onClose: () => void;
  actionLabel?: string;
  valid?: (draft: T) => boolean;
  returnFocus?: () => HTMLElement | null | undefined;
  children: (draft: T, change: (next: T) => void) => ReactNode;
}) {
  const formId = useId();
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    function resize(): void {
      surface.current?.style.setProperty(
        '--ui-editor-top',
        `${String(visual?.offsetTop ?? 0)}px`,
      );
      surface.current?.style.setProperty(
        '--ui-editor-height',
        `${String(visual?.height ?? window.innerHeight)}px`,
      );
    }
    resize();
    visual.addEventListener('resize', resize);
    visual.addEventListener('scroll', resize);
    return () => {
      visual.removeEventListener('resize', resize);
      visual.removeEventListener('scroll', resize);
    };
  }, []);
  function close(): void {
    if (pending) return;
    onClose();
  }
  async function submit(): Promise<void> {
    if (pending || !valid(draft)) return;
    // Keep focus inside the sheet before disabling the submitting control.
    surface.current
      ?.querySelector<HTMLElement>('[aria-label="Discard"]')
      ?.focus({ preventScroll: true });
    setPending(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, 'Could not save'));
      setPending(false);
    }
  }
  return createPortal(
    <div ref={surface} className="focused-editor">
      <Sheet
        label={title}
        title={title}
        closeLabel="Discard"
        placement="center"
        onClose={close}
        returnFocus={returnFocus}
      >
        <SheetActions>
          <button
            type="submit"
            form={formId}
            className="ui-button is-primary ui-editor-action"
            aria-label={pending ? 'Saving…' : actionLabel}
            title={actionLabel}
            disabled={pending || !valid(draft)}
          >
            {pending ? (
              <RefreshIcon className="ui-saving" />
            ) : actionLabel === 'Done' ? (
              <CheckIcon />
            ) : (
              <SaveIcon />
            )}
            {actionLabel.split(' ')[0]}
          </button>
        </SheetActions>
        <form
          id={formId}
          className="focused-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void submit();
          }}
        >
          <fieldset className="settings-group" inert={pending}>
            {children(draft, setDraft)}
          </fieldset>
          {error === null ? null : (
            <p className="ui-notice" role="alert">
              {error}
            </p>
          )}
        </form>
      </Sheet>
    </div>,
    document.body,
  );
}
