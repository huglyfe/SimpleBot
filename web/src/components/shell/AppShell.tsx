import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { STORAGE_KEYS } from '@simplebot/shared';
import type { Bootstrap } from '@simplebot/shared';

import { readStorage, writeStorage } from '../../lib/storage.js';
import { useMediaQuery } from '../../lib/useMediaQuery.js';
import { ConversationHeader } from './ConversationHeader.js';
import { DesktopDrawer } from './DesktopDrawer.js';
import { NewBotPanel } from '../sheets/NewBotPanel.js';
import { NavigationDrawer } from './NavigationDrawer.js';

export const PHONE_QUERY = '(max-width: 800px)';

function readDesktopCollapsed(): boolean {
  return readStorage(STORAGE_KEYS.drawer) === 'closed';
}

export interface AppShellProps {
  data: Bootstrap;
  activeSessionId: string | null;
  activeBotSlug: string | undefined;
  onSelectSession: (id: string) => void;
  onNewConversation: (botSlug: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDeleteSession: (id: string) => void;
  onManageBot: (botSlug: string) => void;
  onDeleteBotConversations: (botSlug: string) => void;
  onAddBot: (name: string, file?: File) => Promise<void>;
  error: string | null;
  onOpenProviders: () => void;
  onOpenCapabilities: () => void;
  onOpenApplication: () => void;
  onOpenBotSheet: () => void;
  onOpenConversation: () => void;
  onOpenPreset: () => void;
  children: ReactNode;
}

/**
 * Shell geometry and drawer state. The drawer overlays the conversation on a
 * phone and persists beside it on desktop.
 *
 * There is one toggle, and it lives where the drawer is: the header hamburger
 * opens it, and while open that control becomes the close X inside the drawer
 * itself, so the affordance sits on the panel it dismisses.
 */
export function AppShell({
  data,
  activeSessionId,
  activeBotSlug,
  children,
  ...handlers
}: AppShellProps): ReactElement {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [desktopCollapsed, setDesktopCollapsed] =
    useState(readDesktopCollapsed);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  if (!isPhone && phoneOpen) setPhoneOpen(false);
  const drawerOpen = isPhone ? phoneOpen : !desktopCollapsed;

  const openRef = useRef<HTMLButtonElement | null>(null);
  function toggleDrawer(): void {
    if (isPhone) {
      setPhoneOpen((open) => !open);
      return;
    }
    setDesktopCollapsed((collapsed) => {
      writeStorage(STORAGE_KEYS.drawer, collapsed ? 'open' : 'closed');
      return !collapsed;
    });
  }

  /** Selecting or creating a conversation dismisses the drawer on a phone. */
  function dismissing<A extends unknown[]>(
    handler: (...args: A) => void,
  ): (...args: A) => void {
    return (...args) => {
      handler(...args);
      if (isPhone) setPhoneOpen(false);
    };
  }

  const drawer = (
    <NavigationDrawer
      data={data}
      activeSessionId={activeSessionId}
      overlay={isPhone}
      returnFocus={() => openRef.current}
      onClose={toggleDrawer}
      onSelectSession={dismissing(handlers.onSelectSession)}
      onNewConversation={dismissing(handlers.onNewConversation)}
      onRenameSession={handlers.onRenameSession}
      onDeleteSession={handlers.onDeleteSession}
      onManageBot={handlers.onManageBot}
      onDeleteBotConversations={handlers.onDeleteBotConversations}
      onNewBot={() => setCreating(true)}
      error={handlers.error}
      onOpenProviders={handlers.onOpenProviders}
      onOpenCapabilities={handlers.onOpenCapabilities}
      onOpenApplication={handlers.onOpenApplication}
    />
  );

  const bot = data.bots.find((item) => item.slug === activeBotSlug);
  const presetSlug = data.sessions.find(
    (session) => session.id === activeSessionId,
  )?.presetSlug;

  return (
    <div className="shell-root">
      {isPhone ? (
        drawerOpen ? (
          drawer
        ) : null
      ) : (
        <DesktopDrawer open={drawerOpen}>{drawer}</DesktopDrawer>
      )}

      {creating ? (
        <NewBotPanel
          onAddBot={handlers.onAddBot}
          onClose={() => setCreating(false)}
          returnFocus={() =>
            drawerOpen
              ? document.querySelector<HTMLElement>('.drawer-add-bot')
              : openRef.current
          }
        />
      ) : null}

      <div className="shell-main">
        <ConversationHeader
          bot={bot}
          presetSlug={presetSlug}
          conversationActive={activeSessionId !== null}
          drawerOpen={drawerOpen}
          onToggleDrawer={toggleDrawer}
          onOpenBotSheet={handlers.onOpenBotSheet}
          onOpenConversation={handlers.onOpenConversation}
          onOpenPreset={handlers.onOpenPreset}
          toggleRef={openRef}
        />
        {handlers.error === null || (isPhone && drawerOpen) ? null : (
          <p className="ui-notice" role="alert">
            {handlers.error}
          </p>
        )}
        <div className="shell-content">{children}</div>
      </div>
    </div>
  );
}
