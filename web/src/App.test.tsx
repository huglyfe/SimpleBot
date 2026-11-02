import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap } from '@simplebot/shared';

import { App } from './App.js';

/**
 * The drawer's mutations are the surface that used to swallow failures: each
 * was a `void`ed promise, so a refused create or delete became an unhandled
 * rejection and nothing on screen changed.
 */
const api = vi.hoisted(() => ({
  cancelAttempt: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  discardAttachment: vi.fn(),
  getBootstrap: vi.fn(),
  getPositions: vi.fn(),
  getPresetList: vi.fn(async () => []),
  getSession: vi.fn(),
  importBot: vi.fn(),
  mutateSession: vi.fn(),
  requestSpeech: vi.fn(),
  setTitle: vi.fn(),
  streamAttempt: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock('./api.js', () => api);

const bootstrap: Bootstrap = {
  version: '0.10.0',
  ttsConfigured: false,
  time: { timezone: 'UTC', clockFormat: '24' },
  bots: [{ slug: 'seraphina', name: 'Seraphina', avatarUrl: null }],
  sessions: [],
};

describe('navigation mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    // The failure must remain visible in the phone layout, where navigation
    // dismisses the drawer before the rejected request settles.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 800px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });

  it('reports an offline read once and waits for explicit Refresh', async () => {
    onlineManager.setOnline(false);
    api.getBootstrap.mockRejectedValue(new Error('Server unavailable'));
    render(<App />);
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Server unavailable',
    );

    await act(async () => {
      onlineManager.setOnline(true);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(api.getBootstrap).toHaveBeenCalledTimes(1);

    api.getBootstrap.mockResolvedValue(bootstrap);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Start a conversation')).toBeVisible();
    expect(api.getBootstrap).toHaveBeenCalledTimes(2);
  });

  it('keeps the mounted app when a background refresh fails', async () => {
    api.getBootstrap
      .mockResolvedValueOnce(bootstrap)
      .mockRejectedValue(new Error('Read failed'));
    api.createSession.mockResolvedValue('new-session');
    render(<App />);
    const welcome = await screen.findByText('Start a conversation');
    const grid = document.querySelector<HTMLElement>('.bot-grid');
    if (grid === null) throw new Error('Missing bot grid');
    await userEvent.click(
      within(grid).getByRole('button', { name: /Seraphina/ }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Read failed',
    );
    expect(welcome).toBeVisible();
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    expect(api.getBootstrap).toHaveBeenCalledTimes(2);
    api.getBootstrap.mockResolvedValue(bootstrap);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(welcome).toBeVisible();
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });

  it('keeps a refused conversation create visible after the phone drawer closes', async () => {
    api.getBootstrap.mockResolvedValue(bootstrap);
    api.createSession.mockRejectedValue(new Error('Character card is invalid'));

    render(<App />);
    await screen.findByText('Start a conversation');
    // The drawer lists the same bot; the welcome grid is the tile that
    // starts a conversation, so the assertion has to name that one.
    const grid = document.querySelector<HTMLElement>('.bot-grid');
    if (grid === null) throw new Error('Expected the bot grid');
    await userEvent.click(
      within(grid).getByRole('button', { name: /Seraphina/ }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Character card is invalid',
      );
    });
  });

  it('renders when browser preference storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage blocked');
      },
      setItem: () => {
        throw new Error('Storage blocked');
      },
      removeItem: () => {
        throw new Error('Storage blocked');
      },
    });
    api.getBootstrap.mockResolvedValue(bootstrap);

    render(<App />);

    expect(await screen.findByText('Start a conversation')).toBeInTheDocument();
  });
});

it('shows one standard popup for concurrent bootstrap and conversation failures and refreshes both without losing the draft', async () => {
  vi.clearAllMocks();
  const user = userEvent.setup();
  const session = {
    id: 'session-1',
    botSlug: 'seraphina',
    presetSlug: 'default',
    title: 'Conversation',
    updatedAt: '2026-09-21T12:00:00.000Z',
  };
  const data = { ...bootstrap, sessions: [session] };
  const projection = {
    ...session,
    createdAt: session.updatedAt,
    activeAttemptId: null,
    page: { positions: [], hasMore: false },
  };
  api.getBootstrap
    .mockResolvedValueOnce(data)
    .mockRejectedValue(new Error('Server unavailable'));
  api.getSession
    .mockResolvedValueOnce(projection)
    .mockRejectedValue(new Error('Server unavailable'));
  render(<App />);
  await user.type(await screen.findByLabelText('Message'), 'Keep my draft');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
  try {
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await screen.findByRole('alertdialog');
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('Keep my draft');
    api.getBootstrap.mockResolvedValue(data);
    api.getSession.mockResolvedValue(projection);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(3));
    expect(api.getBootstrap).toHaveBeenCalledTimes(3);
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Message')).toHaveValue('Keep my draft');
  } finally {
    clock.mockRestore();
    focusManager.setFocused(undefined);
  }
});
