import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRightIcon, ChevronUpIcon, CloseIcon } from '../../icons.js';
import { useDialog } from '../../lib/focus.js';
import { UnsavedChangesDialog } from './UnsavedChangesDialog.js';
import { IconButton } from './IconButton.js';

/**
 * A sheet arrives from where its control lives, so the panel reads as an
 * expansion of the thing you pressed rather than a generic overlay:
 * `side` for the header's conversation controls, `top` for the bot
 * identity above the transcript, `center` for the drawer's application
 * settings, which belong to no one edge.
 */
export type SheetPlacement = 'side' | 'top' | 'center';

export interface SheetProps {
  label: string;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  /** Side sheets only; centered and top sheets size to the viewport. */
  width?: number;
  placement?: SheetPlacement;
  children: ReactNode;
  dismissible?: boolean;
  returnFocus?: (() => HTMLElement | null | undefined) | undefined;
}

/**
 * The close affordance points back the way the sheet came in: a side sheet is
 * anchored right, so its chevron points right, opposite the drawer's.
 */
const DISMISS: Record<SheetPlacement, { icon: ReactNode; title: string }> = {
  side: { icon: <ChevronRightIcon />, title: 'Back' },
  top: { icon: <ChevronUpIcon />, title: 'Close' },
  center: { icon: <CloseIcon />, title: 'Close' },
};

/** Overlay panel with scrim, focus containment, Escape, and focus return. */
export function Sheet({
  label,
  title,
  onClose,
  closeLabel = 'Close panel',
  width = 420,
  placement = 'side',
  children,
  returnFocus,
  dismissible = true,
}: SheetProps) {
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const owner = useRef<SheetEditor | null>(null);
  const [busy, setBusy] = useState(false);
  const registration = useMemo(() => ({ owner, setBusy }), []);
  const canDismiss = dismissible && !busy;
  const [discarding, setDiscarding] = useState(false);
  const close = () => {
    const state = owner.current;
    if (!dismissible || state?.busy) return;
    if (state?.dirty) setDiscarding(true);
    else onClose();
  };
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialog = useDialog({
    onDismiss: close,
    returnFocus,
    dismissible: canDismiss,
    initialFocus: () => closeRef.current,
  });

  useLayoutEffect(() => {
    const panel = dialog.ref.current;
    if (!panel) return;
    if (!canDismiss) panel.focus({ preventScroll: true });
    else if (document.activeElement === panel)
      closeRef.current?.focus({ preventScroll: true });
  }, [canDismiss, dialog.ref]);

  const style = placement === 'side' ? { width } : undefined;

  return (
    <>
      <dialog
        {...dialog}
        tabIndex={-1}
        className={`ui-sheet is-${placement}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={style}
      >
        <header className="ui-sheet-header">
          <IconButton
            label={closeLabel}
            danger={closeLabel === 'Discard'}
            title={
              closeLabel === 'Close panel'
                ? DISMISS[placement].title
                : closeLabel
            }
            onClick={close}
            ref={closeRef}
            disabled={!canDismiss}
          >
            {DISMISS[placement].icon}
          </IconButton>
          <div className="ui-sheet-heading">
            <h2 className="ui-sheet-title">{title}</h2>
          </div>
          <div className="ui-sheet-actions" ref={setActionHost} />
        </header>
        <SheetActionHost value={actionHost}>
          <SheetOwner value={registration}>
            <div className="ui-sheet-body ui-scrollbar">{children}</div>
          </SheetOwner>
        </SheetActionHost>
      </dialog>
      {discarding ? (
        <UnsavedChangesDialog
          onSave={async () => {
            await owner.current?.save();
          }}
          onCancel={() => setDiscarding(false)}
          onContinue={onClose}
        />
      ) : null}
    </>
  );
}

const SheetActionHost = createContext<HTMLDivElement | null>(null);

/** Keep action state with its editor while placing controls in the sheet header. */
export function SheetActions({ children }: { children: ReactNode }) {
  const host = useContext(SheetActionHost);
  return host ? createPortal(children, host) : children;
}

export interface SheetEditor {
  busy: boolean;
  dirty: boolean;
  save: () => Promise<void>;
}
const SheetOwner = createContext<{
  owner: React.RefObject<SheetEditor | null>;
  setBusy: (busy: boolean) => void;
} | null>(null);
/** Publish busy state for controls; read the current draft only on dismissal. */
export function useSheetEditor(state: SheetEditor): void {
  const registration = useContext(SheetOwner);
  const owner = registration?.owner;
  useLayoutEffect(() => {
    if (!owner) return;
    owner.current = state;
    return () => {
      owner.current = null;
    };
  }, [owner, state]);
  useLayoutEffect(() => {
    registration?.setBusy(state.busy);
    return () => registration?.setBusy(false);
  }, [registration, state.busy]);
}
