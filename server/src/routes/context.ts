/**
 * What every route module is handed. It is the same closure `createApp` used
 * to hold, named once so each surface can live in its own file without any of
 * them owning state the others need.
 */

import type { MutableModels } from '@earendil-works/pi-ai';
import type { SessionChange, SessionContext } from '@simplebot/shared';

import type { AttemptManager } from '../attempts.js';
import type { OwnerAuth } from '../auth.js';
import type { AuthoredFiles } from '../authored.js';
import type { ActivatedCapabilities } from '../capabilities.js';
import type { SessionCron } from '../cron.js';
import { StorageNotFoundError, type Storage } from '../storage.js';
import type { Speech } from '../tts.js';

export interface RouteDependencies {
  storage: Storage;
  auth: OwnerAuth;
  authored: AuthoredFiles;
  attempts: AttemptManager;
  cron: SessionCron;
  capabilities: () => ActivatedCapabilities;
  reloadDependencies: () => Promise<void>;
  speech: Speech;
  models: MutableModels;
  loginEnabled: boolean;
}

export interface RouteContext extends RouteDependencies {
  now: () => Date;
  /**
   * A mutation answers with session state plus the rows it changed. It never
   * re-ships the transcript: the client holds pages and patches them by ID.
   */
  change: (
    sessionId: string,
    changed?: { positionIds?: readonly string[] },
  ) => SessionChange;
  /** The separately loaded Context projection: leaves and context accounting. */
  sessionContext: (sessionId: string) => Promise<SessionContext>;
}

export function createRouteContext(
  dependencies: RouteDependencies,
  now: () => Date,
): RouteContext {
  return {
    ...dependencies,
    now,
    change: (sessionId, changed = {}) =>
      dependencies.storage.sessionChange({
        sessionId,
        ...changed,
      }),
    sessionContext: async (sessionId) => {
      const identity = dependencies.storage.sessionIdentity(sessionId);
      if (identity === null)
        throw new StorageNotFoundError('Session not found');
      const authored = await dependencies.authored.readSessionSettings(
        identity.presetSlug,
      );
      const at = now();
      return {
        timezone: authored.config.application.timezone,
        ...dependencies.storage.contextEvidence(
          sessionId,
          authored.preset.context.activeLeafCap,
          authored.config.application.timezone,
          at,
          authored.preset.context.liveTailExchanges,
        ),
      };
    },
  };
}
