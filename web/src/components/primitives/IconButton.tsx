import type { AriaAttributes, MouseEventHandler, ReactNode, Ref } from 'react';
import { cx } from '../../lib/cx.js';

export interface IconButtonProps {
  label: string;
  title?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /** Appended to the accessible name when a disabled control needs explanation. */
  disabledReason?: string | undefined;
  danger?: boolean;
  warning?: boolean;
  ref?: Ref<HTMLButtonElement> | undefined;
  ariaControls?: string | undefined;
  ariaExpanded?: boolean | undefined;
  ariaHasPopup?: AriaAttributes['aria-haspopup'];
  children: ReactNode;
}

/** Round 44px-target icon button. Always requires an accessible label. */
export function IconButton({
  label,
  title,
  onClick,
  disabled = false,
  disabledReason,
  danger = false,
  warning = false,
  ref,
  ariaControls,
  ariaExpanded,
  ariaHasPopup,
  children,
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        'ui-icon-button',
        danger && 'is-danger',
        warning && 'is-warning',
      )}
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      aria-label={
        disabled && disabledReason ? `${label}. ${disabledReason}` : label
      }
      title={disabled && disabledReason ? disabledReason : (title ?? label)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
