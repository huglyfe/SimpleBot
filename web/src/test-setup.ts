import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

import {
  TestIntersectionObserver,
  resetIntersections,
} from './test-intersection.js';

afterEach(() => {
  cleanup();
  resetIntersections();
});

// jsdom implements no layout, so `scrollIntoView` and `scrollTo` are absent.
// Transcript movement needs real browser coverage; no-ops here do not
// claim anything about geometry.
Element.prototype.scrollIntoView = () => undefined;
Element.prototype.scrollTo = () => undefined;
globalThis.requestAnimationFrame = (callback) =>
  window.setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle);

class TestResizeObserver implements ResizeObserver {
  observe(): void {
    return undefined;
  }
  unobserve(): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
}
globalThis.ResizeObserver = TestResizeObserver;

/**
 * Without layout nothing has a rectangle, so nothing intersects on its own.
 * This one reports only when a test delivers a crossing, which proves what
 * the component does with one without inventing the geometry that caused it.
 */
globalThis.IntersectionObserver = TestIntersectionObserver;

// jsdom has no top layer. Browser journeys own real focus and hit testing.
const modalDialogs: HTMLDialogElement[] = [];
function exposeTopDialog() {
  const top = modalDialogs.at(-1);
  for (const dialog of document.querySelectorAll('dialog[open]')) {
    if (top && dialog !== top && !dialog.contains(top))
      dialog.setAttribute('aria-hidden', 'true');
    else dialog.removeAttribute('aria-hidden');
  }
}
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
  modalDialogs.push(this);
  exposeTopDialog();
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
  const index = modalDialogs.indexOf(this);
  if (index >= 0) modalDialogs.splice(index, 1);
  exposeTopDialog();
};

// user-event does not implement the browser's Escape-to-cancel default action.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.defaultPrevented)
    modalDialogs
      .at(-1)
      ?.dispatchEvent(new Event('cancel', { cancelable: true }));
});
afterEach(() => {
  modalDialogs.length = 0;
});

// jsdom does not supply viewport media queries. Individual responsive tests override this.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: () => ({ matches: false }),
});
