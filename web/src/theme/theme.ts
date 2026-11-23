import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from '@simplebot/shared';
import { readStorage, writeStorage } from '../lib/storage.js';

const APPEARANCES = ['system', 'light', 'dark'] as const;
/** Accent themes; `tokens.css` holds one `[data-accent]` rule per non-default. */
export const ACCENTS = [
  'violet',
  'azure',
  'lagoon',
  'sage',
  'rose',
  'graphite',
] as const;

export type Appearance = (typeof APPEARANCES)[number];
export type Accent = (typeof ACCENTS)[number];
export interface Theme {
  appearance: Appearance;
  accent: Accent;
}

let theme: Theme = { appearance: 'system', accent: 'violet' };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Theme {
  return theme;
}

function stored<Value extends string>(
  key: string,
  values: readonly Value[],
  fallback: Value,
): Value {
  const raw = readStorage(key);
  return values.find((value) => value === raw) ?? fallback;
}

/** The default of each axis is the absence of its attribute. */
function applyTheme({ appearance, accent }: Theme): void {
  const root = document.documentElement;
  if (appearance === 'system') delete root.dataset.theme;
  else root.dataset.theme = appearance;
  if (accent === 'violet') delete root.dataset.accent;
  else root.dataset.accent = accent;
}

function setTheme(next: Theme): void {
  writeStorage(STORAGE_KEYS.appearance, next.appearance);
  writeStorage(STORAGE_KEYS.accent, next.accent);
  theme = next;
  applyTheme(next);
  for (const listener of listeners) listener();
}

export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void } {
  return { theme: useSyncExternalStore(subscribe, getSnapshot), setTheme };
}

/** Reads storage and applies the theme synchronously before React renders. */
export function initTheme(): void {
  theme = {
    appearance: stored(STORAGE_KEYS.appearance, APPEARANCES, 'system'),
    accent: stored(STORAGE_KEYS.accent, ACCENTS, 'violet'),
  };
  applyTheme(theme);
}
