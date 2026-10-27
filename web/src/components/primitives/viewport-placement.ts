import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

export type PreferredSide = 'above' | 'below';
export type InlineAlignment = 'start' | 'end';

export interface PlacementBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FloatingPlacement {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  side: PreferredSide;
}

/** Pure geometry shared by every viewport-contained menu and pop-out. */
export function placeFloatingSurface(input: {
  trigger: PlacementBox;
  panel: { width: number; height: number };
  viewport: ViewportBounds;
  preferredSide: PreferredSide;
  align: InlineAlignment;
  gap: number;
}): FloatingPlacement {
  const { trigger, panel, viewport, preferredSide, align, gap } = input;
  const maxWidth = Math.max(0, viewport.right - viewport.left);
  const width = Math.min(panel.width, maxWidth);
  const preferredLeft =
    align === 'start' ? trigger.left : trigger.left + trigger.width - width;
  const left = Math.min(
    Math.max(preferredLeft, viewport.left),
    viewport.right - width,
  );
  const above = trigger.top - viewport.top - gap;
  const below = viewport.bottom - (trigger.top + trigger.height) - gap;
  const preferredRoom = preferredSide === 'above' ? above : below;
  const alternateRoom = preferredSide === 'above' ? below : above;
  const side =
    panel.height <= preferredRoom || preferredRoom >= alternateRoom
      ? preferredSide
      : preferredSide === 'above'
        ? 'below'
        : 'above';
  const available = side === 'above' ? above : below;
  const height = Math.min(panel.height, Math.max(0, available));
  const top =
    side === 'above'
      ? Math.max(viewport.top, trigger.top - gap - height)
      : trigger.top + trigger.height + gap;
  return { left, top, maxWidth, maxHeight: Math.max(0, available), side };
}

function cssPixels(name: string): number {
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function readViewport(): ViewportBounds {
  const visual = window.visualViewport;
  const offsetLeft = visual?.offsetLeft ?? 0;
  const offsetTop = visual?.offsetTop ?? 0;
  const width = visual?.width ?? window.innerWidth;
  const height = visual?.height ?? window.innerHeight;
  const gutter = cssPixels('--floating-gutter');
  return {
    left: offsetLeft + gutter,
    top: offsetTop + gutter,
    right: offsetLeft + width - gutter,
    bottom: offsetTop + height - gutter,
  };
}

/**
 * Positions a fixed surface against the live visual viewport. Fixed placement
 * escapes clipped ancestors; measurement, clamping, and flipping
 * replace per-component offsets and width guesses.
 */
export function useViewportPlacement(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  preferredSide: PreferredSide,
  align: InlineAlignment,
): { style: CSSProperties; side: PreferredSide } | null {
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const triggerElement = trigger.current;
    const panelElement = panel.current;
    if (triggerElement === null || panelElement === null) return;
    const triggerNode: HTMLElement = triggerElement;
    const panelNode: HTMLElement = panelElement;

    function update(): void {
      const triggerRect = triggerNode.getBoundingClientRect();
      const panelRect = panelNode.getBoundingClientRect();
      setPlacement(
        placeFloatingSurface({
          trigger: {
            left: triggerRect.left,
            top: triggerRect.top,
            width: triggerRect.width,
            height: triggerRect.height,
          },
          panel: { width: panelRect.width, height: panelRect.height },
          viewport: readViewport(),
          preferredSide,
          align,
          gap: cssPixels('--floating-gap'),
        }),
      );
    }

    update();
    const observer = new ResizeObserver(update);
    observer.observe(panelNode);
    observer.observe(triggerNode);
    const visual = window.visualViewport;
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
    };
  }, [align, open, panel, preferredSide, trigger]);

  return placement === null
    ? null
    : {
        side: placement.side,
        style: {
          left: placement.left,
          top: placement.top,
          maxWidth: placement.maxWidth,
          maxHeight: placement.maxHeight,
        },
      };
}
