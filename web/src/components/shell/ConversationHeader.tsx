import type { ReactElement, Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PRODUCT_NAME,
  promptTokenCount,
  type Bootstrap,
} from '@simplebot/shared';

import { getPresetDocument } from '../../api.js';
import type { ConversationState } from '../../lib/conversation.js';
import { ContextRingIcon, MenuIcon, TuneIcon } from '../../icons.js';
import { Avatar } from '../primitives/Avatar.js';
import { IconButton } from '../primitives/IconButton.js';

type Bot = Bootstrap['bots'][number];

export interface ConversationHeaderProps {
  bot: Bot | undefined;
  /** The selected conversation; controls need one. */
  sessionId: string | null;
  presetSlug: string | null;
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
  presetSlug,
  drawerOpen,
  onToggleDrawer,
  onOpenBotSheet,
  onOpenConversation,
  onOpenPreset,
  toggleRef,
}: ConversationHeaderProps): ReactElement {
  // The ring asks for nothing per message. Usage arrives on the reply itself,
  // so this only observes the transcript Conversation loads; the threshold is
  // the preset document the Preset panel edits, read once and then kept
  // current by that panel's saves.
  const conversation = useQuery<ConversationState>({
    queryKey: ['session', sessionId],
    enabled: false,
  }).data;
  const preset = useQuery({
    queryKey: ['authored', `presets/${encodeURIComponent(presetSlug ?? '')}`],
    queryFn: () => getPresetDocument(presetSlug ?? ''),
    enabled: presetSlug !== null,
    staleTime: Infinity,
  }).data;
  // The same two numbers the acceptance gate compares: the newest reply with
  // content, and its last provider call.
  const latest = conversation?.positions.findLast(
    (position) =>
      position.role === 'assistant' &&
      (position.variant.source !== '' ||
        position.variant.provider === 'authored'),
  );
  const usage =
    latest?.role === 'assistant' ? (latest.variant.usage.at(-1) ?? null) : null;
  const threshold = preset?.value.context.thresholdTokens;
  const promptTokens = usage === null ? null : promptTokenCount(usage);
  const progress =
    promptTokens === null || threshold === undefined
      ? null
      : promptTokens / threshold;
  const full = progress !== null && progress >= 1;

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
              : `Context ${promptTokens.toLocaleString()} of ${threshold.toLocaleString()} input tokens${full ? ' · compacts on next message' : ''}`
          }
          disabled={sessionId === null}
          onClick={onOpenConversation}
        >
          <ContextRingIcon
            progress={progress}
            className={full ? 'context-ring is-full' : 'context-ring'}
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
