/** Browser preferences are conveniences; unavailable storage must not stop UI. */
type StorageArea = 'localStorage' | 'sessionStorage';

export function readStorage(
  key: string,
  area: StorageArea = 'localStorage',
): string | null {
  try {
    return globalThis[area].getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(
  key: string,
  value: string | null,
  area: StorageArea = 'localStorage',
): void {
  try {
    if (value === null) globalThis[area].removeItem(key);
    else globalThis[area].setItem(key, value);
  } catch {
    // A private or host-restricted browser may deny preference storage.
  }
}
