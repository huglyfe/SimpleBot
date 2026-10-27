import type { ReactElement, Ref } from 'react';
import { PRODUCT_NAME, type Bootstrap } from '@simplebot/shared';

import { MenuIcon, MessageIcon, SlidersIcon } from '../../icons.js';
import { Avatar } from '../primitives/Avatar.js';
import { IconButton } from '../primitives/IconButton.js';

type Bot = Bootstrap['bots'][number];

export interface ConversationHeaderProps {
  bot: Bot | undefined;
  /** True when a conversation is selected; the identity button needs one. */
  conversationActive: boolean;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onOpenBotSheet: () => void;
  onOpenConversation: () => void;
  onOpenPreset: () => void;
  /** AppShell returns focus here when the phone drawer closes. */
  toggleRef?: Ref<HTMLButtonElement>;
}

/**
 * The hamburger opens the drawer and then hands off: while the drawer is
 * open, the close X inside it is the toggle, so only one control is ever
 * visible for one piece of state.
 */
export function ConversationHeader({
  bot,
  conversationActive,
  drawerOpen,
  onToggleDrawer,
  onOpenBotSheet,
  onOpenConversation,
  onOpenPreset,
  toggleRef,
}: ConversationHeaderProps): ReactElement {
  return (
    <header className="shell-header">
      <div className="header-side">
        {drawerOpen ? null : (
          <IconButton
            label="Open conversations"
            onClick={onToggleDrawer}
            ref={toggleRef}
          >
            <MenuIcon />
          </IconButton>
        )}
      </div>

      <div className="header-center">
        {conversationActive && bot !== undefined ? (
          <button
            type="button"
            className="bot-identity"
            onClick={onOpenBotSheet}
          >
            <Avatar name={bot.name} artworkUrl={bot.avatarUrl} size={32} />
            <span>{bot.name}</span>
          </button>
        ) : (
          <strong>{PRODUCT_NAME}</strong>
        )}
      </div>

      <div className="header-side is-right">
        <IconButton
          label="Conversation controls"
          disabled={!conversationActive}
          onClick={onOpenConversation}
        >
          <MessageIcon />
        </IconButton>
        <IconButton
          label="Preset settings"
          disabled={!conversationActive}
          onClick={onOpenPreset}
        >
          <SlidersIcon />
        </IconButton>
      </div>
    </header>
  );
}
