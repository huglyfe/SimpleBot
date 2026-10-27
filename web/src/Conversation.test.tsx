import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AttemptEvent,
  MessagePosition,
  SessionChange,
  SessionProjection,
} from '@simplebot/shared';

import { Conversation } from './Conversation.js';

const api = vi.hoisted(() => ({
  cancelAttempt: vi.fn(),
  discardAttachment: vi.fn(),
  getPositions: vi.fn(),
  getSession: vi.fn(),
  mutateSession: vi.fn(),
  streamAttempt: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock('./api.js', () => api);

const now = '2026-08-14T09:00:00.000Z';

function assistant(
  source: string,
  effects: Extract<
    MessagePosition,
    { role: 'assistant' }
  >['variant']['effects'] = [],
): Extract<MessagePosition, { role: 'assistant' }> {
  return {
    id: 'assistant-position',
    ordinal: 1,
    role: 'assistant',
    locked: false,
    variant: {
      id: 'assistant-variant',
      ordinal: 1,
      source,
      trace: [],
      provider: 'openrouter',
      model: 'test-model',
      usage: [],
      effects,
      createdAt: now,
    },
    variantIndex: 0,
    variantCount: 2,
    createdAt: now,
  };
}

function projection(
  positions: MessagePosition[] = [],
  id = 'session-1',
): SessionProjection {
  return {
    id,
    botSlug: 'seraphina',
    presetSlug: 'default',
    createdAt: now,
    updatedAt: now,
    activeAttemptId: null,
    page: { positions, hasMore: false },
  };
}

function userPosition(
  source: string,
): Extract<MessagePosition, { role: 'user' }> {
  return {
    id: 'user-position',
    ordinal: 0,
    role: 'user',
    source,
    attachments: [],
    createdAt: now,
  };
}

function change(position: MessagePosition): SessionChange {
  const { page: _page, ...state } = projection();
  return { ...state, positions: [position] };
}

function queued(): AttemptEvent {
  return { type: 'queued', attemptId: 'attempt-1', at: now };
}

function admitted(): AttemptEvent {
  return {
    type: 'admitted',
    attemptId: 'attempt-1',
    at: now,
    positionId: 'assistant-position',
    variantId: 'assistant-variant',
  };
}

function completed(): AttemptEvent {
  return {
    type: 'completed',
    attemptId: 'attempt-1',
    at: now,
    positionId: 'assistant-position',
    variantId: 'assistant-variant',
  };
}

let sessionCounter = 0;

async function renderConversation(
  positions: MessagePosition[] = [],
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): Promise<string> {
  sessionCounter += 1;
  const sessionId = `session-${String(sessionCounter)}`;
  api.getSession.mockResolvedValue(projection(positions, sessionId));
  render(
    <QueryClientProvider client={client}>
      <Conversation
        sessionId={sessionId}
        ttsConfigured={false}
        botName="Seraphina"
      />
    </QueryClientProvider>,
  );
  await screen.findByLabelText('Message');
  return sessionId;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.cancelAttempt.mockResolvedValue(undefined);
  api.discardAttachment.mockResolvedValue(undefined);
  api.uploadAttachment.mockResolvedValue('attachment-1');
});

describe('Conversation', () => {
  it('keeps cached messages visible when a background read fails', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const sessionId = await renderConversation(
      [assistant('Keep this answer.')],
      client,
    );
    api.getSession.mockRejectedValueOnce(new Error('Network unavailable'));
    await act(() =>
      client.invalidateQueries({ queryKey: ['session', sessionId] }),
    );
    expect(screen.getByText('Keep this answer.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    api.getSession.mockResolvedValue(
      projection([assistant('Current answer.')], sessionId),
    );
    await act(() =>
      client.invalidateQueries({ queryKey: ['session', sessionId] }),
    );
    expect(await screen.findByText('Current answer.')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('detaches an admitted stream on return and reads its continuing server attempt', async () => {
    const sessionId = await renderConversation();
    const active = {
      ...projection([userPosition('go'), assistant('')], sessionId),
      activeAttemptId: 'attempt-1',
    };
    api.getSession.mockResolvedValue(active);
    api.streamAttempt.mockImplementation(
      (
        _id: string,
        _command: unknown,
        signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
        onOpen: (id: string) => void,
      ) => {
        onOpen('attempt-1');
        onEvent(admitted());
        onEvent({
          type: 'text_delta',
          attemptId: 'attempt-1',
          at: now,
          delta: 'Partial live answer.',
        });
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('Detached')),
            { once: true },
          ),
        );
      },
    );
    await userEvent.type(screen.getByLabelText('Message'), 'go');
    await userEvent.click(screen.getByLabelText('Send message'));
    expect(await screen.findByText('Partial live answer.')).toBeVisible();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(
        screen.queryByText('Partial live answer.'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Stop response')).toBeInTheDocument();
    expect(api.cancelAttempt).not.toHaveBeenCalled();
    api.getSession.mockResolvedValue(
      projection([userPosition('go'), assistant('Finished away.')], sessionId),
    );
    expect(
      await screen.findByText('Finished away.', {}, { timeout: 2_000 }),
    ).toBeVisible();
    expect(screen.queryByLabelText('Stop response')).not.toBeInTheDocument();
  });

  it('keeps queued work in the composer instead of creating transcript rows', async () => {
    const user = userEvent.setup();
    await renderConversation();
    api.streamAttempt.mockImplementation(
      (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
        onOpen: (attemptId: string) => void,
      ) => {
        onOpen('attempt-1');
        onEvent(queued());
        return new Promise(() => undefined);
      },
    );

    await user.type(screen.getByLabelText('Message'), 'still mine');
    await user.click(screen.getByLabelText('Send message'));

    expect(screen.getByLabelText('Message')).toHaveValue('still mine');
    expect(document.querySelectorAll('.msg-row')).toHaveLength(0);
    expect(screen.getByLabelText('Stop response')).toBeInTheDocument();
  });

  it('hands the draft to stored positions on admitted and takes canonical completion', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const sessionId = await renderConversation([], client);
    const completedProjection = projection(
      [userPosition('hello'), assistant('canonical answer')],
      sessionId,
    );
    api.getSession.mockResolvedValue(completedProjection);
    api.streamAttempt.mockImplementation(
      async (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
        onOpen: (attemptId: string) => void,
      ) => {
        onOpen('attempt-1');
        onEvent(queued());
        onEvent(admitted());
        onEvent({
          type: 'text_delta',
          attemptId: 'attempt-1',
          at: now,
          delta: 'streamed answer',
        });
        onEvent(completed());
        return true;
      },
    );

    await user.type(screen.getByLabelText('Message'), 'hello');
    await user.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByLabelText('Message')).toHaveValue('');
      expect(screen.getByText('canonical answer')).toBeInTheDocument();
    });
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['bootstrap'],
    });
  });

  it('ignores an older stream while the next attempt owns the conversation', async () => {
    const user = userEvent.setup();
    await renderConversation();
    let previousEvent!: (event: AttemptEvent) => void;
    api.streamAttempt.mockImplementationOnce(
      async (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
      ) => {
        previousEvent = onEvent;
        onEvent(admitted());
      },
    );
    await user.type(screen.getByLabelText('Message'), 'first');
    await user.click(screen.getByLabelText('Send message'));
    await screen.findByLabelText('Send message');

    api.streamAttempt.mockImplementationOnce(
      (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
      ) => {
        onEvent(admitted());
        onEvent({
          type: 'text_delta',
          attemptId: 'attempt-2',
          at: now,
          delta: 'Current answer',
        });
        return new Promise(() => undefined);
      },
    );
    await user.type(screen.getByLabelText('Message'), 'second');
    await user.click(screen.getByLabelText('Send message'));
    act(() =>
      previousEvent({
        type: 'text_delta',
        attemptId: 'attempt-1',
        at: now,
        delta: 'Stale answer',
      }),
    );
    expect(screen.getByText('Current answer')).toBeInTheDocument();
    expect(screen.queryByText(/Stale answer/)).not.toBeInTheDocument();
  });

  it('keeps the draft and reports a rejection before admission', async () => {
    const user = userEvent.setup();
    await renderConversation();
    api.streamAttempt.mockRejectedValue(new Error('request refused'));

    await user.type(screen.getByLabelText('Message'), 'keep this');
    await user.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('request refused');
    });
    expect(screen.getByLabelText('Message')).toHaveValue('keep this');
  });

  it('refreshes a detached response without automatically accepting its effects', async () => {
    const user = userEvent.setup();
    const sessionId = await renderConversation([]);
    api.getSession.mockResolvedValue(
      projection(
        [
          userPosition('already stored'),
          assistant('Completed while disconnected.', [
            {
              id: 'effect-1',
              ordinal: 0,
              type: 'variable_set',
              arguments: {},
              state: 'candidate',
              result: null,
            },
          ]),
        ],
        sessionId,
      ),
    );
    api.streamAttempt.mockImplementation(
      async (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
      ) => {
        onEvent(admitted());
        throw new Error('stream disconnected');
      },
    );

    await user.type(screen.getByLabelText('Message'), 'already stored');
    await user.click(screen.getByLabelText('Send message'));

    expect(
      await screen.findByText('Completed while disconnected.'),
    ).toBeVisible();
    expect(api.mutateSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lets Stop finalize the admitted response through the stream', async () => {
    const user = userEvent.setup();
    const sessionId = await renderConversation();
    let finish = () => undefined;
    api.streamAttempt.mockImplementation(
      (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
        onOpen: (attemptId: string) => void,
      ) => {
        onOpen('attempt-1');
        onEvent(admitted());
        return new Promise<boolean>((resolve) => {
          finish = () => {
            onEvent(completed());
            resolve(true);
          };
        });
      },
    );
    api.cancelAttempt.mockImplementation(() => {
      api.getSession.mockResolvedValue(
        projection(
          [
            userPosition('stop this'),
            assistant(
              '<system_error>Generation stopped by operator.</system_error>',
            ),
          ],
          sessionId,
        ),
      );
      finish();
      return Promise.resolve();
    });

    await user.type(screen.getByLabelText('Message'), 'stop this');
    await user.click(screen.getByLabelText('Send message'));
    await user.click(await screen.findByLabelText('Stop response'));

    expect(api.cancelAttempt).toHaveBeenCalledWith(sessionId, 'attempt-1');
    expect(
      await screen.findByText('Generation stopped by operator.'),
    ).toHaveClass('ui-hint is-error');
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('leaves completed internal effects pending until explicit acceptance', async () => {
    const user = userEvent.setup();
    const sessionId = await renderConversation([]);
    const candidate = assistant('done', [
      {
        id: 'effect-1',
        ordinal: 0,
        type: 'variable_set',
        arguments: {},
        state: 'candidate',
        result: null,
      },
    ]);
    api.getSession.mockResolvedValue(
      projection([userPosition('go'), candidate], sessionId),
    );
    api.mutateSession.mockResolvedValue(change(candidate));
    api.streamAttempt.mockImplementation(
      async (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
      ) => {
        onEvent(admitted());
        onEvent(completed());
        return true;
      },
    );

    await user.type(screen.getByLabelText('Message'), 'go');
    await user.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(api.streamAttempt).toHaveBeenCalledWith(
        sessionId,
        {
          kind: 'reply',
          text: 'go',
        },
        expect.any(AbortSignal),
        expect.any(Function),
        expect.any(Function),
      );
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Send message')).toBeInTheDocument(),
    );
    expect(api.mutateSession).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Apply effects' }));
    expect(api.mutateSession).toHaveBeenCalledWith(
      sessionId,
      '/positions/assistant-position/accept',
      'POST',
      undefined,
    );
  });

  it('requests a swipe without a write mode', async () => {
    const user = userEvent.setup();
    const first = assistant('first');
    first.variantCount = 1;
    const sessionId = await renderConversation([first]);
    api.getSession.mockResolvedValue(
      projection([assistant('second')], sessionId),
    );
    api.streamAttempt.mockImplementation(
      async (
        _sessionId: string,
        _command: unknown,
        _signal: AbortSignal,
        onEvent: (event: AttemptEvent) => void,
      ) => {
        onEvent(admitted());
        onEvent(completed());
        return true;
      },
    );

    await user.click(
      screen.getByRole('button', { name: 'Generate another reply' }),
    );

    await waitFor(() => {
      expect(api.streamAttempt).toHaveBeenCalledWith(
        sessionId,
        {
          kind: 'swipe',
          positionId: 'assistant-position',
        },
        expect.any(AbortSignal),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  it('reports a refused transcript mutation', async () => {
    const user = userEvent.setup();
    await renderConversation([assistant('first')]);
    api.mutateSession.mockRejectedValue(new Error('Position is locked'));

    await user.click(screen.getByRole('button', { name: 'Next variant' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Position is locked',
    );
  });
});
