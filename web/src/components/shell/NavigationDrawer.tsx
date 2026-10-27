import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Bootstrap } from '@simplebot/shared';

import {
  ChevronLeftIcon,
  DotsIcon,
  KeyIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ToolsIcon,
} from '../../icons.js';
import { searchSessions } from '../../api.js';
import { useDialog } from '../../lib/focus.js';
import { cx } from '../../lib/cx.js';
import { Avatar } from '../primitives/Avatar.js';
import { IconButton } from '../primitives/IconButton.js';
import { FocusedEditor } from '../sheets/FocusedEditor.js';
import { Menu } from '../primitives/Menu.js';
import { errorMessage } from '../../lib/errorMessage.js';

type Bot = Bootstrap['bots'][number];
type Session = Bootstrap['sessions'][number];
const NO_MATCHES: ReadonlyMap<string, string> = new Map();

export interface NavigationDrawerProps {
  data: Bootstrap;
  activeSessionId: string | null;
  /** Phone: the drawer is a modal dialog over the conversation. */
  overlay: boolean;
  returnFocus?: () => HTMLElement | null;
  /** The drawer holds the toggle while it is open; the header holds it otherwise. */
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onNewConversation: (botSlug: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDeleteSession: (id: string) => void;
  onManageBot: (botSlug: string) => void;
  onDeleteBotConversations: (botSlug: string) => void;
  onNewBot: () => void;
  /** The one navigation failure, shown here while a phone drawer is open. */
  error: string | null;
  onOpenProviders: () => void;
  onOpenCapabilities: () => void;
  onOpenApplication: () => void;
}

/** Most recently active first, so the bot you are talking to stays on top. */
function orderBotsByActivity(bots: Bot[], sessions: Session[]): Bot[] {
  const lastActivity = new Map<string, string>();
  for (const session of sessions) {
    const current = lastActivity.get(session.botSlug);
    if (current === undefined || session.updatedAt > current) {
      lastActivity.set(session.botSlug, session.updatedAt);
    }
  }
  return [...bots].sort((a, b) => {
    const left = lastActivity.get(a.slug) ?? '';
    const right = lastActivity.get(b.slug) ?? '';
    if (left !== right) return right.localeCompare(left);
    return a.name.localeCompare(b.name);
  });
}

export function NavigationDrawer({
  data,
  activeSessionId,
  overlay,
  returnFocus,
  onClose,
  onSelectSession,
  onNewConversation,
  onRenameSession,
  onDeleteSession,
  onManageBot,
  onDeleteBotConversations,
  onNewBot,
  error,
  onOpenProviders,
  onOpenCapabilities,
  onOpenApplication,
}: NavigationDrawerProps): ReactElement {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialog = useDialog({
    modal: overlay,
    onDismiss: onClose,
    initialFocus: () => closeRef.current,
    returnFocus,
  });
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<Pick<
    Session,
    'id' | 'title'
  > | null>(null);

  const bots = useMemo(
    () => orderBotsByActivity(data.bots, data.sessions),
    [data.bots, data.sessions],
  );
  const [searchResult, setSearchResult] = useState<{
    query: string;
    matches: ReadonlyMap<string, string>;
    error: string | null;
  }>({ query: '', matches: NO_MATCHES, error: null });
  const normalizedQuery = query.trim();
  const matches =
    searchResult.query === normalizedQuery ? searchResult.matches : NO_MATCHES;
  // Titles match immediately; server snippets widen the same grouped list.
  const sessionsByBot = useMemo(() => {
    const needle = normalizedQuery.toLowerCase();
    const matched =
      needle === ''
        ? data.sessions
        : data.sessions.filter(
            (session) =>
              session.title.toLowerCase().includes(needle) ||
              matches.has(session.id),
          );
    return Map.groupBy(matched, (session) => session.botSlug);
  }, [data.sessions, normalizedQuery, matches]);

  // Superseded searches are discarded; failed searches remain visible.
  useEffect(() => {
    const needle = normalizedQuery;
    if (needle === '') {
      setSearchResult({ query: '', matches: NO_MATCHES, error: null });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchSessions(needle, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSearchResult({
            query: needle,
            error: null,
            matches: new Map(
              results.map((result) => [result.sessionId, result.snippet]),
            ),
          });
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setSearchResult({
            query: needle,
            matches: NO_MATCHES,
            error: errorMessage(caught, 'Search failed'),
          });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery]);

  return (
    <dialog
      {...dialog}
      open={overlay ? undefined : true}
      id={overlay ? undefined : 'desktop-conversations'}
      className={cx('sidebar', overlay && 'is-overlay')}
      aria-label="Conversations"
      aria-modal={overlay || undefined}
      role={overlay ? 'dialog' : 'navigation'}
    >
      <div className="sidebar-top">
        <label className="drawer-search">
          <SearchIcon />
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            placeholder="Search conversations"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        {/*
          A chevron, not an X. Sitting immediately beside the search field, an
          X reads as "clear this field" no matter what its accessible name
          says; a back-pointing chevron can only mean the rail it lives on.
        */}
        <IconButton
          label="Close conversations"
          onClick={onClose}
          ref={closeRef}
        >
          <ChevronLeftIcon />
        </IconButton>
      </div>

      {searchResult.query === normalizedQuery && searchResult.error !== null ? (
        <p className="ui-notice" role="alert">
          Conversation search failed: {searchResult.error}. Showing title
          matches only.
        </p>
      ) : null}

      <div className="sidebar-scroll ui-scrollbar">
        {bots.map((bot) => {
          const owned = sessionsByBot.get(bot.slug) ?? [];
          const isCollapsed = collapsed[bot.slug] === true;
          return (
            <section className="bot-group" key={bot.slug}>
              <div className="bot-heading">
                <button
                  type="button"
                  className="bot-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => {
                    setCollapsed((value) => ({
                      ...value,
                      [bot.slug]: !isCollapsed,
                    }));
                  }}
                >
                  <Avatar
                    name={bot.name}
                    artworkUrl={bot.avatarUrl}
                    size={28}
                  />
                  <strong>{bot.name}</strong>
                  {isCollapsed && <span className="count">{owned.length}</span>}
                </button>
                {/*
                  One stable action slot, not two. An expanded bot is
                  one you are working in, so the slot is the direct new
                  conversation; a collapsed one is at rest, so the slot is
                  the menu — which offers the same new conversation without
                  making you expand the group first.
                */}
                {isCollapsed ? (
                  <Menu
                    label={`Actions for ${bot.name}`}
                    icon={<DotsIcon />}
                    items={[
                      {
                        label: 'New conversation',
                        onSelect: () => {
                          onNewConversation(bot.slug);
                        },
                      },
                      {
                        label: 'Manage bot',
                        onSelect: () => {
                          onManageBot(bot.slug);
                        },
                      },
                      {
                        label: 'Delete all conversations',
                        destructive: true,
                        onSelect: () => {
                          onDeleteBotConversations(bot.slug);
                        },
                      },
                    ]}
                  />
                ) : (
                  <IconButton
                    label={`New conversation with ${bot.name}`}
                    onClick={() => {
                      onNewConversation(bot.slug);
                    }}
                  >
                    <PlusIcon />
                  </IconButton>
                )}
              </div>

              {isCollapsed ? null : (
                <div className="session-list">
                  {owned.map((session) => (
                    <article
                      className={cx(
                        'session-row',
                        session.id === activeSessionId && 'is-active',
                      )}
                      key={session.id}
                    >
                      <button
                        type="button"
                        className="session-main"
                        aria-current={
                          session.id === activeSessionId ? 'page' : undefined
                        }
                        onClick={() => {
                          onSelectSession(session.id);
                        }}
                      >
                        <strong>{session.title}</strong>
                        {matches.get(session.id) === undefined ? null : (
                          <span>{matches.get(session.id)}</span>
                        )}
                      </button>
                      <Menu
                        className="session-menu"
                        label={`Actions for ${session.title}`}
                        icon={<DotsIcon />}
                        items={[
                          {
                            label: 'Edit title',
                            onSelect: () => {
                              setRenaming({
                                id: session.id,
                                title: session.title,
                              });
                            },
                          },
                          {
                            label: 'Delete',
                            destructive: true,
                            onSelect: () => {
                              onDeleteSession(session.id);
                            },
                          },
                        ]}
                      />
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <button type="button" className="drawer-add-bot" onClick={onNewBot}>
          <PlusIcon />
          New bot
        </button>
        {overlay && error !== null ? (
          <p className="ui-hint is-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="sidebar-footer" aria-label="Application settings">
        <IconButton label="Providers and keys" onClick={onOpenProviders}>
          <KeyIcon />
          <span>Providers</span>
        </IconButton>
        <IconButton label="Capabilities" onClick={onOpenCapabilities}>
          <ToolsIcon />
          <span>Capabilities</span>
        </IconButton>
        <IconButton label="Application settings" onClick={onOpenApplication}>
          <SettingsIcon />
          <span>Settings</span>
        </IconButton>
      </footer>
      {renaming === null ? null : (
        <FocusedEditor
          title="Edit conversation title"
          actionLabel="Save title"
          value={renaming.title}
          valid={(title) => title.trim().length > 0}
          onSave={(title) => onRenameSession(renaming.id, title.trim())}
          onClose={() => setRenaming(null)}
        >
          {(title, change) => (
            <input
              aria-label="Conversation title"
              value={title}
              onChange={(event) => change(event.target.value)}
            />
          )}
        </FocusedEditor>
      )}
    </dialog>
  );
}
