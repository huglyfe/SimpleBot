import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type SyntheticEvent,
  type MouseEvent,
} from 'react';

/** Privacy concealment defers new modals without disturbing existing drafts. */
export const DialogsSuspended = createContext(false);

/** Native dialogs own the top layer, background inertness, and keyboard focus. */
export function useDialog({
  onDismiss,
  dismissible = true,
  modal = true,
  initialFocus,
  returnFocus,
}: {
  onDismiss: () => void;
  dismissible?: boolean;
  modal?: boolean;
  initialFocus: (dialog: HTMLDialogElement) => HTMLElement | null | undefined;
  returnFocus?: (() => HTMLElement | null | undefined) | undefined;
}) {
  const suspended = useContext(DialogsSuspended);
  const ref = useRef<HTMLDialogElement>(null);
  const initial = useRef(initialFocus);
  const returning = useRef(returnFocus);
  initial.current = initialFocus;
  returning.current = returnFocus;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!modal || !dialog) return;
    const previous = document.activeElement;
    return () => {
      dialog.close();
      // Resolve the destination after React removes or replaces the opener.
      queueMicrotask(() => {
        let target = returning.current?.() ?? previous;
        if (target instanceof HTMLElement && target.matches(':disabled'))
          target =
            target
              .closest('dialog')
              ?.querySelector<HTMLElement>('button:not(:disabled)') ?? null;
        if (target instanceof HTMLElement && target.isConnected)
          target.focus({ preventScroll: true });
      });
    };
  }, [modal]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (modal && !suspended && dialog && !dialog.open) {
      dialog.showModal();
      initial.current(dialog)?.focus({ preventScroll: true });
    }
  }, [modal, suspended]);
  return {
    ref,
    onCancel(event: SyntheticEvent<HTMLDialogElement>) {
      event.preventDefault();
      event.stopPropagation();
      if (dismissible) onDismiss();
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      if (!modal || !dismissible || event.target !== event.currentTarget)
        return;
      const { left, right, top, bottom } =
        event.currentTarget.getBoundingClientRect();
      if (
        event.clientX < left ||
        event.clientX > right ||
        event.clientY < top ||
        event.clientY > bottom
      )
        onDismiss();
    },
  };
}
