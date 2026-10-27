import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from '@simplebot/shared';
import { readStorage, writeStorage } from '../lib/storage.js';

export type Appearance = 'system' | 'light' | 'dark';

let appearance: Appearance = 'system';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Appearance {
  return appearance;
}

function emit(next: Appearance): void {
  appearance = next;
  applyTheme(next);
  for (const listener of listeners) listener();
}

function readStoredAppearance(): Appearance {
  const raw = readStorage(STORAGE_KEYS.appearance);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

function applyTheme(appearance: Appearance): void {
  const root = document.documentElement;
  if (appearance === 'system') delete root.dataset.theme;
  else root.dataset.theme = appearance;
}

function setAppearance(appearance: Appearance): void {
  writeStorage(STORAGE_KEYS.appearance, appearance);
  emit(appearance);
}

export function useTheme(): {
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
} {
  const appearance = useSyncExternalStore(subscribe, getSnapshot);
  return {
    appearance,
    setAppearance,
  };
}

/** Reads storage and applies the theme synchronously before React renders. */
export function initTheme(): void {
  appearance = readStoredAppearance();
  applyTheme(appearance);
}
