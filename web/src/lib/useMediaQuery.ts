import { useCallback, useSyncExternalStore } from 'react';

/** Reactive matchMedia subscription. Re-subscribes when the query changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => {
        mql.removeEventListener('change', onStoreChange);
      };
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
