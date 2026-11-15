import type { ReactElement, Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PRODUCT_NAME,
  promptTokenCount,
  type Bootstrap,
} from '@simplebot/shared';

import { getContext } from '../../api.js';
import { ContextRingIcon, MenuIcon, TuneIcon } from '../../icons.js';
import { Avatar } from '../primitives/Avatar.js';
import { IconButton } from '../primitives/IconButton.js';

type Bot = Bootstrap['bots'][number];

export interface ConversationHeaderProps {
  bot: Bot | undefined;
  /** The selected conversation; controls need one. */
  sessionId: string | null;
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
  sessionId,
  drawerOpen,
  onToggleDrawer,
  onOpenBotSheet,
  onOpenConversation,
  onOpenPreset,
  toggleRef,
}: ConversationHeaderProps): ReactElement {
  const context = useQuery({
    queryKey: ['context', sessionId],
    queryFn: () => getContext(sessionId ?? ''),
    enabled: sessionId !== null,
  });
  // The same two numbers the acceptance gate compares.
  const usage = context.data?.lastRequestUsage ?? null;
  const threshold = context.data?.compactionThresholdTokens;
  const promptTokens = usage === null ? null : promptTokenCount(usage);
  const progress =
    promptTokens === null || threshold === undefined
      ? null
      : promptTokens / threshold;

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
        {sessionId !== null && bot !== undefined ? (
          <button
            type="button"
            className="bot-identity"
            aria-label={bot.name}
            onClick={onOpenBotSheet}
          >
            <Avatar name={bot.name} artworkUrl={bot.avatarUrl} size={44} />
            <span className="bot-identity-name">
              <strong>{bot.name}</strong>
            </span>
          </button>
        ) : (
          <strong>{PRODUCT_NAME}</strong>
        )}
      </div>

      <div className="header-side is-right">
        <IconButton
          label="Conversation controls"
          title={
            promptTokens === null || threshold === undefined
              ? 'Conversation controls'
              : `Context ${promptTokens.toLocaleString()} of ${threshold.toLocaleString()} tokens before compaction`
          }
          disabled={sessionId === null}
          onClick={onOpenConversation}
        >
          <ContextRingIcon
            progress={progress}
            className={
              progress !== null && progress >= 1
                ? 'context-ring is-full'
                : 'context-ring'
            }
          />
        </IconButton>
        <IconButton
          label="Preset settings"
          disabled={sessionId === null}
          onClick={onOpenPreset}
        >
          <TuneIcon />
        </IconButton>
      </div>
    </header>
  );
}
