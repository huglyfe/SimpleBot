import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@simplebot/shared';

import { initTheme } from './theme.js';

interface BrowserHarness {
  storage: Map<string, string>;
  dataset: Record<string, string>;
}

function installBrowserHarness(): BrowserHarness {
  const storage = new Map<string, string>();
  const dataset: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
  vi.stubGlobal('document', {
    documentElement: { dataset },
  });
  return { storage, dataset };
}

describe('appearance', () => {
  let browser: BrowserHarness;

  beforeEach(() => {
    browser = installBrowserHarness();
  });

  it('restores explicit appearance on startup', () => {
    browser.storage.set(STORAGE_KEYS.appearance, 'dark');
    initTheme();

    expect(browser.dataset.theme).toBe('dark');
  });
});
