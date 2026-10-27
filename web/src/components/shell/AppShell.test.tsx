import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@simplebot/shared';
import type { Bootstrap } from '@simplebot/shared';

import * as api from '../../api.js';
import { AppShell, PHONE_QUERY } from './AppShell.js';

vi.mock('../../api.js', () => ({ searchSessions: vi.fn() }));

const data: Bootstrap = {
  version: '0.10.0',
  ttsConfigured: false,
  bots: [{ slug: 'seraphina', name: 'Seraphina', avatarUrl: null }],
  sessions: [
    {
      id: 'session-1',
      botSlug: 'seraphina',
      presetSlug: 'default',
      title: 'Morning walk',
      updatedAt: '2026-08-14T09:00:00.000Z',
    },
  ],
};

/** Drives `useMediaQuery`, which is the only breakpoint authority in the shell. */
function setViewport(phone: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === PHONE_QUERY ? phone : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const noop = () => undefined;

function renderShell({
  bootstrap = data,
  onRenameSession = async () => undefined,
  onAddBot = async () => undefined,
  onOpenCapabilities = noop,
  onOpenConversation = noop,
  onOpenPreset = noop,
}: {
  bootstrap?: Bootstrap;
  onAddBot?: (name: string, file?: File) => Promise<void>;
  onRenameSession?: (id: string, title: string) => Promise<void>;
  onOpenCapabilities?: () => void;
  onOpenConversation?: () => void;
  onOpenPreset?: () => void;
} = {}) {
  return render(
    <AppShell
      data={bootstrap}
      activeSessionId="session-1"
      activeBotSlug="seraphina"
      onSelectSession={noop}
      onNewConversation={noop}
      onRenameSession={onRenameSession}
      onDeleteSession={noop}
      onManageBot={noop}
      onDeleteBotConversations={noop}
      onAddBot={onAddBot}
      error={null}
      onOpenProviders={noop}
      onOpenCapabilities={onOpenCapabilities}
      onOpenApplication={noop}
      onOpenBotSheet={noop}
      onOpenConversation={onOpenConversation}
      onOpenPreset={onOpenPreset}
    >
      <p>transcript</p>
    </AppShell>,
  );
}

let store: Map<string, string>;

beforeEach(() => {
  vi.resetAllMocks();
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell drawer', () => {
  it('stages a card or name in New bot and keeps failed submissions in that panel', async () => {
    setViewport(false);
    const user = userEvent.setup();
    const add = vi
      .fn<(name: string, file?: File) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Bot already exists'))
      .mockResolvedValue(undefined);
    renderShell({ onAddBot: add });
    expect(screen.queryByLabelText('Import card')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New bot' }));
    const panel = screen.getByRole('dialog', { name: 'New bot' });
    await user.type(within(panel).getByLabelText('Bot name'), 'Kept name');
    const file = new File(['{}'], 'hero.json', { type: 'application/json' });
    await user.upload(within(panel).getByLabelText('Import card'), file);
    expect(add).not.toHaveBeenCalled();
    expect(within(panel).getByLabelText('Bot name')).toHaveValue('Kept name');
    await user.click(within(panel).getByRole('button', { name: 'Clear card' }));
    expect(within(panel).getByLabelText('Bot name')).toHaveValue('Kept name');
    await user.upload(within(panel).getByLabelText('Import card'), file);
    await user.click(within(panel).getByRole('button', { name: 'Create bot' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Bot already exists',
    );
    expect(within(panel).getByText('hero.json')).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Create bot' }));
    expect(add).toHaveBeenNthCalledWith(1, 'Kept name', file);
    expect(add).toHaveBeenNthCalledWith(2, 'Kept name', file);
    expect(
      screen.queryByRole('dialog', { name: 'New bot' }),
    ).not.toBeInTheDocument();
  });

  it('discards a selected character card without installing a bot', async () => {
    setViewport(false);
    const user = userEvent.setup();
    const add = vi.fn();
    renderShell({ onAddBot: add });
    await user.click(screen.getByRole('button', { name: 'New bot' }));
    await user.upload(
      screen.getByLabelText('Import card'),
      new File(['{}'], 'hero.json', { type: 'application/json' }),
    );
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(add).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'New bot' })).toHaveFocus();
  });

  it.each(['not-a-width', 'Infinity', '0', '900'])(
    'ignores an invalid saved desktop width: %s',
    (saved) => {
      setViewport(false);
      store.set(STORAGE_KEYS.drawerWidth, saved);
      renderShell();
      expect(
        screen.getByRole('separator', { name: 'Resize conversations' }),
      ).toHaveAttribute('aria-valuenow', '292');
    },
  );

  it('resizes without available browser preference storage', async () => {
    setViewport(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage denied');
      },
      setItem: () => {
        throw new Error('Storage denied');
      },
    });
    renderShell();
    const divider = screen.getByRole('separator', {
      name: 'Resize conversations',
    });
    divider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(divider).toHaveAttribute('aria-valuenow', '308');
  });

  it('keeps a failed title edit open and blocks duplicate submissions while saving', async () => {
    setViewport(false);
    const user = userEvent.setup();
    const saved = Promise.withResolvers<undefined>();
    const rename = vi
      .fn()
      .mockRejectedValueOnce(new Error('Title rejected'))
      .mockReturnValueOnce(saved.promise);
    renderShell({ onRenameSession: rename });
    await user.click(
      screen.getByRole('button', { name: 'Actions for Morning walk' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Edit title' }));
    const title = screen.getByRole('textbox', { name: 'Conversation title' });
    await user.clear(title);
    await user.type(title, 'Evening walk{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Title rejected',
    );
    expect(title).toHaveValue('Evening walk');
    await user.click(screen.getByRole('button', { name: 'Save title' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(title.closest('fieldset')).toHaveAttribute('inert');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(
      screen.getByRole('dialog', { name: 'Edit conversation title' }),
    ).toBeVisible();
    saved.resolve(undefined);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(rename).toHaveBeenCalledTimes(2);
    expect(rename).toHaveBeenLastCalledWith('session-1', 'Evening walk');
  });

  it('moves the single toggle into the drawer while it is open', async () => {
    setViewport(false);
    renderShell();

    // Open: the close X lives inside the drawer and the header hamburger is gone.
    const close = screen.getByRole('button', { name: 'Close conversations' });
    expect(
      screen.getByRole('navigation', { name: 'Conversations' }),
    ).toContainElement(close);
    expect(
      screen.queryByRole('button', { name: 'Open conversations' }),
    ).not.toBeInTheDocument();

    await userEvent.click(close);

    // Closed: the hamburger is back and no close control is left behind.
    expect(
      screen.getByRole('button', { name: 'Open conversations' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close conversations' }),
    ).not.toBeInTheDocument();
  });

  it('persists the desktop collapse across mounts', async () => {
    setViewport(false);
    const { unmount } = renderShell();

    await userEvent.click(
      screen.getByRole('button', { name: 'Close conversations' }),
    );
    expect(store.get(STORAGE_KEYS.drawer)).toBe('closed');
    unmount();

    renderShell();
    expect(
      screen.getByRole('button', { name: 'Open conversations' }),
    ).toBeInTheDocument();
  });

  it('overlays as a modal dialog on a phone and starts closed', async () => {
    setViewport(true);
    renderShell();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Open conversations' }),
    );

    const drawer = screen.getByRole('dialog', { name: 'Conversations' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    // Focus follows the toggle, which is now the drawer's own close control.
    expect(
      screen.getByRole('button', { name: 'Close conversations' }),
    ).toHaveFocus();
  });

  it('closes the phone drawer on Escape and returns focus to the toggle', async () => {
    setViewport(true);
    renderShell();
    const toggle = screen.getByRole('button', { name: 'Open conversations' });

    await userEvent.click(toggle);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open conversations' }),
    ).toHaveFocus();
  });

  it('gives a bot one action slot: new conversation open, the menu collapsed', async () => {
    setViewport(false);
    renderShell();

    // Expanded: the direct action, and no second control beside it.
    expect(
      screen.getByRole('button', { name: 'New conversation with Seraphina' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Actions for Seraphina' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /Seraphina/, expanded: true }),
    );

    // Collapsed: the menu takes the same slot and still offers the same action.
    expect(
      screen.queryByRole('button', { name: 'New conversation with Seraphina' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Actions for Seraphina' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'New conversation' }),
    ).toBeInTheDocument();
  });

  it('persists beside the conversation on desktop rather than overlaying', () => {
    setViewport(false);
    renderShell();

    expect(
      screen.getByRole('navigation', { name: 'Conversations' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Conversation and Preset as distinct header controls', async () => {
    setViewport(false);
    const onOpenConversation = vi.fn();
    const onOpenPreset = vi.fn();
    renderShell({ onOpenConversation, onOpenPreset });

    await userEvent.click(
      screen.getByRole('button', { name: 'Conversation controls' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Preset settings' }),
    );

    expect(onOpenConversation).toHaveBeenCalledOnce();
    expect(onOpenPreset).toHaveBeenCalledOnce();
  });

  it('names the global destinations without a Tools surface', () => {
    setViewport(false);
    renderShell();

    expect(
      screen.getByRole('button', { name: 'Providers and keys' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Capabilities' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Application settings' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Tools and skills' }),
    ).not.toBeInTheDocument();
  });

  it('preserves phone navigation after opening Capabilities', async () => {
    setViewport(true);
    const onOpenCapabilities = vi.fn();
    renderShell({ onOpenCapabilities });

    await userEvent.click(
      screen.getByRole('button', { name: 'Open conversations' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Capabilities' }));

    expect(onOpenCapabilities).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: 'Conversations' })).toBeVisible();
  });

  it('finds a conversation by its message text, not just its title', async () => {
    setViewport(false);
    vi.mocked(api.searchSessions).mockResolvedValue([
      { sessionId: 'session-1', snippet: '…past the [lighthouse] road…' },
    ]);
    renderShell();

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search conversations' }),
      'lighthouse',
    );

    // The title has no such word; the server's index is what keeps the row.
    expect(
      await screen.findByText('…past the [lighthouse] road…'),
    ).toBeVisible();
    expect(screen.getByText('Morning walk')).toBeVisible();
    expect(api.searchSessions).toHaveBeenCalledWith(
      'lighthouse',
      expect.any(AbortSignal),
    );
  });

  it('drops snippets from a superseded search while the next search loads', async () => {
    setViewport(false);
    const nextSearch =
      Promise.withResolvers<Awaited<ReturnType<typeof api.searchSessions>>>();
    vi.mocked(api.searchSessions)
      .mockResolvedValueOnce([
        { sessionId: 'session-1', snippet: '…past the [lighthouse] road…' },
      ])
      .mockReturnValueOnce(nextSearch.promise);
    renderShell();

    const search = screen.getByRole('searchbox', {
      name: 'Search conversations',
    });
    await userEvent.type(search, 'lighthouse');
    expect(
      await screen.findByText('…past the [lighthouse] road…'),
    ).toBeVisible();

    await userEvent.clear(search);
    await userEvent.type(search, 'missing');

    expect(
      screen.queryByText('…past the [lighthouse] road…'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Morning walk')).not.toBeInTheDocument();
    nextSearch.resolve([]);
  });

  it('identifies failed message search and clears the error on a new search', async () => {
    setViewport(false);
    vi.mocked(api.searchSessions).mockRejectedValueOnce(
      new Error('Search unavailable'),
    );
    renderShell();
    const search = screen.getByRole('searchbox', {
      name: 'Search conversations',
    });
    await userEvent.type(search, 'Morning');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Search unavailable. Showing title matches only.',
    );
    expect(screen.getByText('Morning walk')).toBeVisible();
    vi.mocked(api.searchSessions).mockResolvedValueOnce([]);
    await userEvent.clear(search);
    await userEvent.type(search, 'missing');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

it('keeps title and remote search matches under their owning bots', async () => {
  setViewport(false);
  vi.mocked(api.searchSessions).mockResolvedValue([
    { sessionId: 'session-2', snippet: 'A morning remembered' },
  ]);
  renderShell({
    bootstrap: {
      ...data,
      bots: [...data.bots, { slug: 'ada', name: 'Ada', avatarUrl: null }],
      sessions: [
        ...data.sessions,
        {
          id: 'session-2',
          botSlug: 'ada',
          presetSlug: 'default',
          title: 'Evening',
          updatedAt: '2026-09-17T00:00:00.000Z',
        },
      ],
    },
  });
  await userEvent.type(
    screen.getByRole('searchbox', { name: 'Search conversations' }),
    'morning',
  );
  await screen.findByText('A morning remembered');
  expect(
    screen.getByText('Morning walk').closest('.bot-group'),
  ).toHaveTextContent('Seraphina');
  expect(screen.getByText('Evening').closest('.bot-group')).toHaveTextContent(
    'Ada',
  );
  expect(
    screen.getByText('Evening').closest('.bot-group'),
  ).not.toHaveTextContent('Morning walk');
});
