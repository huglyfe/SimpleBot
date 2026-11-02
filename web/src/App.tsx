import { TimePreferences } from './lib/format.js';
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  type Query,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PRODUCT_NAME, STORAGE_KEYS, type Bootstrap } from '@simplebot/shared';

import {
  createSession,
  deleteSession,
  getBootstrap,
  importBot,
  createBot,
  setTitle,
} from './api.js';
import { AppShell } from './components/shell/AppShell.js';
import { DeleteConfirmDialog } from './components/primitives/DeleteConfirmDialog.js';
import { Avatar } from './components/primitives/Avatar.js';
import { ConfirmDialog } from './components/primitives/ConfirmDialog.js';
import { Conversation } from './Conversation.js';

import type { Panel } from './components/sheets/SettingsPanel.js';
import { LazySettingsPanel as SettingsPanel } from './components/sheets/LazySettingsPanel.js';
import { errorMessage } from './lib/errorMessage.js';
import { readStorage, writeStorage } from './lib/storage.js';

const isConversationRead = (query: Pick<Query, 'queryKey'>) =>
  query.queryKey[0] === 'bootstrap' || query.queryKey[0] === 'session';
const failedReads = {
  type: 'active' as const,
  predicate: (query: Query) =>
    isConversationRead(query) && query.state.status === 'error',
};

/** The mounted app owns its cache; failed reads wait for an explicit action. */
export function App() {
  const [readError, setReadError] = useState<Error | null>(null);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (isConversationRead(query)) setReadError(error);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: false,
            networkMode: 'always',
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ChatApp />
      {readError === null ? null : (
        <ConfirmDialog
          title="Unable to load"
          body={readError.message}
          confirmLabel="Refresh"
          cancelLabel="Close"
          dismissible={
            !queryClient
              .getQueryCache()
              .findAll(failedReads)
              .some((query) => query.state.data === undefined)
          }
          onCancel={() => setReadError(null)}
          onConfirm={async () => {
            await queryClient.refetchQueries(failedReads);
            const failure = queryClient.getQueryCache().findAll(failedReads)[0];
            setReadError(failure?.state.error ?? null);
          }}
        />
      )}
    </QueryClientProvider>
  );
}

function ChatApp() {
  const cache = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: getBootstrap,
    refetchOnWindowFocus: (query) => query.state.status === 'success',
  });
  const [activeId, setActiveId] = useState<string | null>(() =>
    readStorage(STORAGE_KEYS.session),
  );
  const [panel, setPanel] = useState<Panel | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<{
    title: string;
    body: string;
    run: () => Promise<void>;
  } | null>(null);
  const data = bootstrap.data;

  useEffect(() => {
    if (data === undefined) return;
    const next = data.sessions.some((session) => session.id === activeId)
      ? activeId
      : (data.sessions[0]?.id ?? null);
    if (next !== activeId) setActiveId(next);
    writeStorage(STORAGE_KEYS.session, next);
  }, [activeId, data]);

  /** One visible failure path for every navigation mutation. */
  async function run(action: () => Promise<void>): Promise<void> {
    setNavigationError(null);
    try {
      await action();
    } catch (caught) {
      setNavigationError(errorMessage(caught, 'That action failed.'));
    }
  }

  async function refresh() {
    await cache.invalidateQueries({ queryKey: ['bootstrap'] });
  }

  async function startConversation(botSlug: string) {
    const id = await createSession(botSlug);
    await refresh();
    setActiveId(id);
  }

  async function removeSession(id: string) {
    await deleteSession(id);
    if (id === activeId) setActiveId(null);
    await refresh();
  }

  async function addBot(name: string, file?: File): Promise<void> {
    const imported =
      file === undefined
        ? await createBot(name)
        : await importBot(file, name || undefined);
    await refresh();
    setPanel({ section: 'bot', slug: imported.slug });
  }

  /**
   * Deleting a bot's conversations is N session deletes, not a new bulk
   * route: sessions are the engine's unit of isolation and each delete is
   * already the authoritative one. A partial failure leaves the survivors
   * visible on the next bootstrap, which is the honest outcome.
   */
  async function deleteBotConversations(botSlug: string) {
    const owned = (data?.sessions ?? []).filter(
      (session) => session.botSlug === botSlug,
    );
    if (owned.length === 0) return;
    try {
      for (const session of owned) await deleteSession(session.id);
    } finally {
      // A partial delete must still refresh the surviving sessions.
      if (owned.some((session) => session.id === activeId)) setActiveId(null);
      await refresh();
    }
  }

  if (bootstrap.isPending)
    return <main className="empty-state">Loading {PRODUCT_NAME}…</main>;
  if (data === undefined) return <main className="empty-state" />;

  const active = data.sessions.find((session) => session.id === activeId);
  const bot = data.bots.find((item) => item.slug === active?.botSlug);

  return (
    <TimePreferences value={data.time}>
      <AppShell
        data={data}
        activeSessionId={activeId}
        activeBotSlug={active?.botSlug}
        onSelectSession={setActiveId}
        onNewConversation={(slug) => void run(() => startConversation(slug))}
        onRenameSession={async (id, title) => {
          await setTitle(id, title);
          await refresh();
        }}
        onDeleteSession={(id) => {
          const title = data.sessions.find(
            (session) => session.id === id,
          )?.title;
          setDeletion({
            title: 'Delete conversation?',
            body: `Delete ${title === undefined ? 'this conversation' : `"${title}"`} and its history? This cannot be undone.`,
            run: () => removeSession(id),
          });
        }}
        onManageBot={(slug) => {
          setPanel({ section: 'bot', slug });
        }}
        onDeleteBotConversations={(slug) => {
          const owned = data.sessions.filter(
            (session) => session.botSlug === slug,
          );
          if (owned.length === 0) return;
          const name =
            data.bots.find((item) => item.slug === slug)?.name ?? slug;
          setDeletion({
            title: 'Delete bot conversations?',
            body: `Delete all ${String(owned.length)} conversations for ${name}? This cannot be undone.`,
            run: () => deleteBotConversations(slug),
          });
        }}
        onAddBot={addBot}
        error={navigationError}
        onOpenProviders={() => {
          setPanel({ section: 'providers' });
        }}
        onOpenCapabilities={() => {
          setPanel({ section: 'capabilities' });
        }}
        onOpenApplication={() => {
          setPanel({ section: 'application' });
        }}
        onOpenBotSheet={() => {
          if (bot !== undefined) setPanel({ section: 'bot', slug: bot.slug });
        }}
        onOpenConversation={() => {
          setPanel({ section: 'conversation' });
        }}
        onOpenPreset={() => {
          setPanel({ section: 'preset' });
        }}
      >
        {active === undefined ? (
          <Welcome
            bots={data.bots}
            create={async (slug) => run(() => startConversation(slug))}
          />
        ) : (
          /*
           * Keyed by session: a conversation root holds one session's live
           * attempt, and without this the same instance carried it across a
           * switch — streaming one session's reply into another's transcript
           * and disabling that session's composer behind it.
           */
          <Conversation
            key={active.id}
            sessionId={active.id}
            ttsConfigured={data.ttsConfigured}
            botName={bot?.name ?? active.botSlug}
          />
        )}
      </AppShell>

      {deletion === null ? null : (
        <DeleteConfirmDialog
          title={deletion.title}
          body={deletion.body}
          onDelete={deletion.run}
          onClose={() => setDeletion(null)}
        />
      )}
      {panel === null ? null : (
        <SettingsPanel
          panel={panel}
          bots={data.bots}
          version={data.version}
          ttsConfigured={data.ttsConfigured}
          session={active}
          onClose={() => setPanel(null)}
        />
      )}
    </TimePreferences>
  );
}

function Welcome({
  bots,
  create,
}: {
  bots: Bootstrap['bots'];
  create: (slug: string) => Promise<void>;
}) {
  return (
    <main className="welcome">
      <div className="brand-mark">{PRODUCT_NAME.slice(0, 1)}</div>
      <h1>Start a conversation</h1>
      <p>
        {bots.length === 0
          ? 'This root has no bots yet. Create or import one from the drawer.'
          : 'Choose a bot.'}
      </p>
      <div className="bot-grid">
        {bots.map((bot) => (
          <button
            key={bot.slug}
            type="button"
            onClick={() => void create(bot.slug)}
          >
            <Avatar name={bot.name} artworkUrl={bot.avatarUrl} size={32} />
            <strong>{bot.name}</strong>
          </button>
        ))}
      </div>
    </main>
  );
}
