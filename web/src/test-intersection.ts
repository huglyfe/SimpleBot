/**
 * A drivable `IntersectionObserver` stand-in for jsdom.
 *
 * jsdom has no layout, so nothing ever intersects on its own and an observer
 * that reports by itself would be inventing geometry. This one never reports
 * unless a test says so, which keeps the honest part — where the viewport
 * actually lands is still only provable in a real browser — while letting a
 * test prove the wiring: that the component observes at all, and that what it
 * does with a crossing is what it claims.
 *
 * Observers are addressed by their `rootMargin`, which is what distinguishes
 * the transcript's two, so a test names the one it means.
 */
type Reporter = (isIntersecting: boolean) => void;

const reporters = new Map<string, Set<Reporter>>();

export class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  readonly #reporter: Reporter;

  constructor(
    callback: IntersectionObserverCallback,
    options?: { rootMargin?: string },
  ) {
    this.rootMargin = options?.rootMargin ?? '';
    this.#reporter = (isIntersecting) => {
      callback([{ isIntersecting } as IntersectionObserverEntry], this);
    };
  }

  observe(): void {
    const group = reporters.get(this.rootMargin) ?? new Set<Reporter>();
    group.add(this.#reporter);
    reporters.set(this.rootMargin, group);
  }

  unobserve(): void {
    reporters.get(this.rootMargin)?.delete(this.#reporter);
  }

  disconnect(): void {
    this.unobserve();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/**
 * Delivers a crossing to every observer registered at `rootMargin`. Throws
 * when there is none, so a test cannot quietly pass by observing nothing.
 */
export function reportIntersection(
  rootMargin: string,
  isIntersecting: boolean,
): void {
  const group = reporters.get(rootMargin);
  if (group === undefined || group.size === 0)
    throw new Error(`Nothing is observing at rootMargin ${rootMargin}`);
  for (const report of group) report(isIntersecting);
}

/** Drops every registration. Observers outlive a test otherwise. */
export function resetIntersections(): void {
  reporters.clear();
}
