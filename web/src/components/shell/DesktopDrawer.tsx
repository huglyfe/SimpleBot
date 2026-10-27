import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { STORAGE_KEYS } from '@simplebot/shared';

import { cx } from '../../lib/cx.js';
import { readStorage, writeStorage } from '../../lib/storage.js';

const DEFAULT_WIDTH = 292;
const MIN_WIDTH = 240;
const MAX_WIDTH = 480;

function readWidth(): number {
  const saved = Number(readStorage(STORAGE_KEYS.drawerWidth));
  return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH
    ? saved
    : DEFAULT_WIDTH;
}

/** Owns desktop geometry so dragging does not rerender the conversation. */
export function DesktopDrawer({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}): ReactElement {
  const [width, setWidth] = useState(readWidth);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const maximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - 400));
  const visibleWidth = Math.min(width, maximum);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  function resize(next: number): void {
    setWidth(Math.round(Math.max(MIN_WIDTH, Math.min(maximum, next))));
  }

  function save(next = width): void {
    writeStorage(STORAGE_KEYS.drawerWidth, String(next));
  }

  return (
    <div
      className={cx('drawer-slot', !open && 'is-collapsed')}
      style={
        { '--ui-drawer-width': `${String(visibleWidth)}px` } as CSSProperties
      }
      aria-hidden={!open}
      inert={!open}
    >
      {children}
      <div
        className="drawer-resizer"
        role="separator"
        aria-label="Resize conversations"
        aria-controls="desktop-conversations"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maximum}
        aria-valuenow={visibleWidth}
        tabIndex={open ? 0 : -1}
        title="Drag to resize; double-click to reset"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width: visibleWidth };
        }}
        onPointerMove={(event) => {
          if (drag.current === null || !event.isPrimary) return;
          resize(drag.current.width + event.clientX - drag.current.x);
        }}
        onPointerUp={(event) => {
          if (drag.current === null) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          save();
        }}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          save(DEFAULT_WIDTH);
        }}
        onKeyDown={(event) => {
          const widths: Record<string, number> = {
            ArrowLeft: visibleWidth - 16,
            ArrowRight: visibleWidth + 16,
            Home: MIN_WIDTH,
            End: maximum,
            Enter: DEFAULT_WIDTH,
          };
          const next = widths[event.key];
          if (next === undefined) return;
          event.preventDefault();
          const clamped = Math.max(MIN_WIDTH, Math.min(maximum, next));
          resize(clamped);
          save(clamped);
        }}
      />
    </div>
  );
}
