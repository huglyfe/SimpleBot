import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttemptCommand, SessionChange } from '@simplebot/shared';

import {
  cancelAttempt,
  discardAttachment,
  getPositions,
  getSession,
  mutateSession,
  streamAttempt,
  uploadAttachment,
} from './api.js';
import { Composer } from './components/composer/Composer.js';
import { Transcript } from './components/transcript/Transcript.js';
import type { LiveAttempt } from './components/transcript/MessageRow.js';
import {
  applyChange,
  collapseToLimit,
  fromProjection,
  mergeTail,
  prependPage,
  type ConversationState,
} from './lib/conversation.js';
import { errorMessage } from './lib/errorMessage.js';
import { livePresentation } from './lib/live-presentation.js';

interface Operation {
  abort: AbortController;
  attemptId: string;
  positionId: string | null;
  admitDraft: () => void;
  presentation: ReturnType<typeof livePresentation> | null;
}

export function Conversation({
  sessionId,
  ttsConfigured,
  botName,
}: {
  sessionId: string;
  ttsConfigured: boolean;
  botName: string;
}) {
  const cache = useQueryClient();
  const queryKey = useMemo(() => ['session', sessionId] as const, [sessionId]);
  const [live, setLive] = useState<LiveAttempt | 'pending' | null>(null);
  const readConversation = useCallback(async (): Promise<ConversationState> => {
    const projection = await getSession(sessionId);
    const current = cache.getQueryData<ConversationState>(queryKey);
    return current === undefined
      ? fromProjection(projection)
      : mergeTail(current, projection);
  }, [cache, queryKey, sessionId]);
  const query = useQuery({
    queryKey,
    queryFn: readConversation,
    refetchOnWindowFocus: (query) => query.state.status === 'success',
    refetchInterval: (query) =>
      live === null &&
      query.state.status === 'success' &&
      query.state.data?.activeAttemptId
        ? 1_000
        : false,
  });
  const [error, setError] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const operation = useRef<Operation | null>(null);

  useEffect(
    () => () => {
      const claimed = operation.current;
      operation.current = null;
      claimed?.presentation?.cancel();
      claimed?.abort.abort();
    },
    [],
  );

  // A suspended browser may retain a dead stream. Detach it on return and
  // read canonical state; the server continues owning the admitted attempt.
  useEffect(() => {
    function onVisible(): void {
      const claimed = operation.current;
      if (document.visibilityState === 'visible' && claimed?.positionId)
        claimed.abort.abort();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const refresh = useCallback(async (): Promise<ConversationState> => {
    const state = await cache.query({
      queryKey,
      queryFn: readConversation,
      staleTime: 0,
    });
    return state;
  }, [cache, queryKey, readConversation]);

  const release = useCallback((claimed: Operation) => {
    if (operation.current !== claimed) return;
    claimed.presentation?.cancel();
    operation.current = null;
    setLive(null);
  }, []);

  const claim = useCallback((admitDraft: () => void): Operation | null => {
    if (operation.current !== null) return null;
    const claimed: Operation = {
      abort: new AbortController(),
      attemptId: '',
      positionId: null,
      admitDraft,
      presentation: null,
    };
    operation.current = claimed;
    setError(null);
    setLive('pending');
    return claimed;
  }, []);

  const applyChangeToCache = useCallback(
    (change: SessionChange) => {
      cache.setQueryData<ConversationState>(queryKey, (current) =>
        current === undefined ? current : applyChange(current, change),
      );
    },
    [cache, queryKey],
  );

  const run = useCallback(
    async (command: AttemptCommand, claimed: Operation): Promise<void> => {
      let admissionRefresh: Promise<unknown> = Promise.resolve();

      try {
        try {
          await streamAttempt(
            sessionId,
            command,
            claimed.abort.signal,
            (event) => {
              if (event.type === 'admitted') {
                claimed.positionId = event.positionId;
                claimed.admitDraft();
                const initial = {
                  positionId: event.positionId,
                  variantId: event.variantId,
                  text: '',
                  trace: [],
                };
                claimed.presentation = livePresentation(initial, (next) => {
                  if (operation.current === claimed) setLive(next);
                });
                setLive(initial);
                admissionRefresh = refresh();
                // The stream may run for minutes. Attach the rejection handler
                // now, then make the canonical completion read independently.
                void admissionRefresh.catch(() => undefined);
                return;
              }
              if (operation.current === claimed)
                claimed.presentation?.update(event);
            },
            (attemptId) => {
              claimed.attemptId = attemptId;
            },
          );
        } catch (caught) {
          if (claimed.positionId === null) {
            if (!claimed.abort.signal.aborted)
              setError(errorMessage(caught, 'Could not send message'));
            throw caught;
          }
        }
        claimed.presentation?.flush();
        const positionId = claimed.positionId;
        if (positionId === null) return;
        await admissionRefresh.catch(() => undefined);
        // Query owns read failures and retains the last loaded transcript.
        await refresh()
          .then(() => {
            void cache.invalidateQueries({ queryKey: ['bootstrap'] });
          })
          .catch(() => undefined);
      } finally {
        release(claimed);
      }
    },
    [cache, refresh, release, sessionId],
  );

  async function send(
    text: string,
    files: File[],
    admitDraft: () => void,
  ): Promise<void> {
    const claimed = claim(admitDraft);
    if (claimed === null) throw new Error('A reply is in flight');

    const uploads = await Promise.allSettled(
      files.map((file) =>
        uploadAttachment(sessionId, file, claimed.abort.signal),
      ),
    );
    const attachmentIds = uploads.flatMap((upload) =>
      upload.status === 'fulfilled' ? [upload.value] : [],
    );
    const failed = uploads.find((upload) => upload.status === 'rejected');
    if (failed !== undefined) {
      await Promise.all(
        attachmentIds.map((id) =>
          discardAttachment(sessionId, id).catch(() => undefined),
        ),
      );
      release(claimed);
      const caught: unknown = failed.reason;
      if (!claimed.abort.signal.aborted) {
        setError(errorMessage(caught, 'Could not upload image'));
      }
      throw caught;
    }

    await run(
      {
        kind: 'reply',
        text,
        ...(attachmentIds.length === 0 ? {} : { attachmentIds }),
      },
      claimed,
    );
  }

  function stop(): void {
    const claimed = operation.current;
    const attemptId = claimed?.attemptId ?? query.data?.activeAttemptId;
    if (claimed !== null && claimed.attemptId === '') {
      claimed.abort.abort();
      return;
    }
    if (!attemptId) return;
    void cancelAttempt(sessionId, attemptId).catch((caught: unknown) => {
      setError(errorMessage(caught, 'Could not stop response'));
    });
  }

  const update = useCallback(
    async (
      suffix: string,
      method: 'DELETE' | 'PATCH' | 'POST',
      body?: unknown,
    ): Promise<void> => {
      const change = await mutateSession(sessionId, suffix, method, body);
      applyChangeToCache(change);
      void cache.invalidateQueries({ queryKey: ['bootstrap'] });
    },
    [applyChangeToCache, cache, sessionId],
  );

  const onAction = useCallback(
    (...args: Parameters<typeof update>) => {
      setError(null);
      void update(...args).catch((caught: unknown) =>
        setError(errorMessage(caught, 'Could not apply change')),
      );
    },
    [update],
  );

  const regenerate = useCallback(
    (positionId: string) => {
      const claimed = claim(() => undefined);
      if (claimed === null) return;
      void run(
        {
          kind: 'swipe',
          positionId,
        },
        claimed,
      ).catch(() => undefined);
    },
    [claim, run],
  );

  const collapse = useCallback(() => {
    cache.setQueryData<ConversationState>(queryKey, (current) =>
      current === undefined ? current : collapseToLimit(current),
    );
  }, [cache, queryKey]);

  const loadEarlier = useCallback(async () => {
    const first = cache.getQueryData<ConversationState>(queryKey)?.positions[0];
    if (first === undefined) return;
    setLoadingEarlier(true);
    try {
      const page = await getPositions(sessionId, first.ordinal);
      cache.setQueryData<ConversationState>(queryKey, (current) =>
        current === undefined ? current : prependPage(current, page),
      );
    } catch (caught) {
      setError(errorMessage(caught, 'Could not load earlier messages'));
    } finally {
      setLoadingEarlier(false);
    }
  }, [cache, queryKey, sessionId]);

  if (query.isPending)
    return <main className="empty-state">Loading conversation…</main>;
  if (query.data === undefined) return <main className="empty-state" />;

  return (
    <main className="conversation">
      <Transcript
        sessionId={sessionId}
        positions={query.data.positions}
        hasMore={query.data.hasMore}
        loadingEarlier={loadingEarlier}
        onLoadEarlier={() => void loadEarlier()}
        onReachLiveEdge={collapse}
        ttsConfigured={ttsConfigured}
        botName={botName}
        live={live === 'pending' ? null : live}
        update={update}
        onAction={onAction}
        regenerate={regenerate}
      />
      <Composer
        sessionId={sessionId}
        botName={botName}
        generating={live !== null || query.data.activeAttemptId !== null}
        error={error}
        onDismissError={() => setError(null)}
        onSend={send}
        onStop={stop}
      />
    </main>
  );
}
