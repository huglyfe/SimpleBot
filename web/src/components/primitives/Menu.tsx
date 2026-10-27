import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cx } from '../../lib/cx.js';
import { useViewportPlacement } from './viewport-placement.js';

export interface MenuItem {
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  /** Accessible name for the trigger, e.g. "Actions for Morning walk". */
  label: string;
  icon: ReactNode;
  items: MenuItem[];
  className?: string;
}

/**
 * Trigger + popup menu that closes on selection, on an outside pointerdown,
 * and on Escape, returning focus to its trigger every time.
 */
export function Menu({
  label,
  icon,
  items,
  className,
}: MenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = `menu-${useId().replace(/:/g, '')}`;
  const floating = useViewportPlacement(
    open,
    triggerRef,
    menuRef,
    'below',
    'end',
  );

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (
        rootRef.current !== null &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        // Focus follows the pointer, so do not steal it back.
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cx('ui-menu', className)}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-icon-button ui-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {icon}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className={cx('ui-menu-list', floating === null && 'is-measuring')}
          data-side={floating?.side}
          style={floating?.style}
          role="menu"
          aria-label={label}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cx(
                'ui-button is-quiet ui-menu-item',
                item.destructive && 'is-danger',
              )}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
