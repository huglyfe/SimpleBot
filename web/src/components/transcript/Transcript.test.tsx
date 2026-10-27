import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MessagePosition, StoredVariant } from '@simplebot/shared';

import { reportIntersection } from '../../test-intersection.js';
import { LIVE_EDGE_MARGIN, Transcript } from './Transcript.js';
import {
  AssistantMessageRow,
  type LiveAttempt,
  type TranscriptUpdate,
} from './MessageRow.js';

function variant(
  id: string,
  source: string,
  reasoning: string | null = null,
): StoredVariant {
  return {
    id,
    ordinal: 1,
    source,
    trace: reasoning === null ? [] : [{ type: 'reasoning', text: reasoning }],
    provider: 'openrouter',
    model: 'test-model',
    usage: [],
    effects: [],
    createdAt: '2026-08-14T09:00:00.000Z',
  };
}

const greeting: Extract<MessagePosition, { role: 'assistant' }> = {
  id: 'position-0',
  ordinal: 0,
  role: 'assistant',
  locked: false,
  variant: variant('variant-a', 'Hello there.'),
  variantIndex: 0,
  variantCount: 2,
  createdAt: '2026-08-14T09:00:00.000Z',
};

function renderTranscript(
  positions: MessagePosition[],
  live: LiveAttempt | null = null,
  update = vi.fn<TranscriptUpdate>(async () => undefined),
) {
  const regenerate = vi.fn();
  render(
    <Transcript
      sessionId="session-1"
      positions={positions}
      botName="Seraphina"
      live={live}
      update={update}
      onAction={(...args) => {
        void update(...args);
      }}
      regenerate={regenerate}
    />,
  );
  return { update, regenerate };
}

function liveAttempt(overrides: Partial<LiveAttempt> = {}): LiveAttempt {
  return {
    positionId: 'position-live',
    variantId: 'variant-live',
    text: '',
    trace: [],
    ...overrides,
  };
}

describe('Transcript', () => {
  it('reports a denied copy and clears the error after an explicit successful copy', async () => {
    const user = userEvent.setup();
    const write = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('Permission denied'));
    renderTranscript([greeting]);
    await user.click(screen.getByRole('button', { name: 'Copy message text' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not copy message: Permission denied',
    );
    write.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: 'Copy message text' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith('Hello there.');
  });

  it('renders the position-0 greeting with its alternates as swipes', () => {
    renderTranscript([greeting]);
    expect(screen.getByText('Hello there.')).toBeInTheDocument();
    expect(screen.getByLabelText('Variant 1 of 2')).toBeInTheDocument();
  });

  it('hides historical swipes while retaining copy and edit', () => {
    renderTranscript([
      { ...greeting, locked: true },
      { ...greeting, id: 'newest', ordinal: 2 },
    ]);
    expect(
      screen.getAllByRole('group', { name: 'Response variants' }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Copy message text' }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: 'Edit message' }),
    ).toHaveLength(2);
  });

  it('deletes a swipe directly from the toolbar with confirmation', async () => {
    const update = vi.fn<TranscriptUpdate>(async () => undefined);
    renderTranscript([greeting], null, update);
    await userEvent.click(screen.getByRole('button', { name: 'Delete swipe' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete swipe' }),
    );

    expect(
      screen.queryByRole('textbox', { name: "Edit Seraphina's message" }),
    ).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledWith('/variants/variant-a', 'DELETE');
  });

  it('selects the next alternate greeting through the swipe control', async () => {
    const { update } = renderTranscript([greeting]);
    await userEvent.click(screen.getByRole('button', { name: 'Next variant' }));
    expect(update).toHaveBeenCalledWith(
      '/positions/position-0/selection',
      'PATCH',
      { direction: 'next' },
    );
  });

  it('disables generation after the last authored greeting', () => {
    const { regenerate } = renderTranscript([
      {
        ...greeting,
        variant: {
          ...greeting.variant,
          id: 'variant-b',
          provider: 'authored',
          model: 'greeting',
        },
        variantIndex: 1,
      },
    ]);

    const generate = screen.getByRole('button', {
      name: /^Generate another reply/u,
    });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute(
      'title',
      'Starting greetings are authored in the Bot panel',
    );
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('shows the exact model id without repeating the provider', () => {
    renderTranscript([greeting]);
    const provenance = screen.getByRole('button', {
      name: 'Response from test-model',
    });
    expect(provenance).toHaveTextContent('test-model');
    expect(provenance).not.toHaveTextContent('openrouter');
  });

  it('expands truncated model provenance when activated', async () => {
    renderTranscript([greeting]);
    const provenance = screen.getByRole('button', {
      name: 'Response from test-model',
    });
    expect(provenance).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(provenance);
    expect(provenance).toHaveAttribute('aria-expanded', 'true');
    expect(provenance).toHaveClass('is-expanded');
  });

  /**
   * jsdom cannot produce the crossing, but it can prove what the component
   * does with one. Both of these are the wiring between the observer and the
   * behaviour it drives — the part that silently did nothing would still have
   * rendered a correct-looking transcript.
   */
  it('trims the loaded transcript when the end comes into view', () => {
    const onReachLiveEdge = vi.fn();
    render(
      <Transcript
        sessionId="session-1"
        positions={[greeting]}
        botName="Seraphina"
        live={null}
        update={vi.fn(async () => undefined)}
        onAction={vi.fn()}
        regenerate={vi.fn()}
        onReachLiveEdge={onReachLiveEdge}
      />,
    );

    expect(onReachLiveEdge).not.toHaveBeenCalled();
    act(() => {
      reportIntersection(LIVE_EDGE_MARGIN, true);
    });
    expect(onReachLiveEdge).toHaveBeenCalledTimes(1);

    // Leaving the edge is not an arrival at it.
    act(() => {
      reportIntersection(LIVE_EDGE_MARGIN, false);
    });
    expect(onReachLiveEdge).toHaveBeenCalledTimes(1);
  });

  it('offers the return control only once the end is out of range', async () => {
    renderTranscript([greeting]);
    const pill = { name: 'Return to latest' };

    expect(screen.queryByRole('button', pill)).not.toBeInTheDocument();
    act(() => {
      reportIntersection('0px 0px 0px 0px', false);
    });
    expect(await screen.findByRole('button', pill)).toBeInTheDocument();

    // Scrolling back within range withdraws it: ordinary scrolling suffices.
    act(() => {
      reportIntersection('0px 0px 0px 0px', true);
    });
    expect(screen.queryByRole('button', pill)).not.toBeInTheDocument();
  });

  it('renders a regenerating attempt in the replaced variant slot, not below it', () => {
    renderTranscript(
      [greeting],
      liveAttempt({ positionId: 'position-0', text: 'Greetings—' }),
    );
    const rows = document.querySelectorAll('.msg-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.className).toContain('is-live');
    expect(screen.queryByText('Hello there.')).not.toBeInTheDocument();
  });

  it('shows no user row for a swipe, which answers a turn already on screen', () => {
    renderTranscript([greeting], liveAttempt({ text: 'Thinking aloud.' }));
    expect(document.querySelectorAll('.msg-row.is-user')).toHaveLength(0);
  });

  it('appends a new reply attempt after the existing positions', () => {
    renderTranscript([greeting], liveAttempt({ text: 'Thinking aloud.' }));
    const rows = [...document.querySelectorAll('.msg-row')];
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)?.className).toContain('is-live');
  });

  it('coalesces streamed live-edge scrolling to one write per frame', () => {
    const frames: FrameRequestCallback[] = [];
    const request = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const view = render(
      <Transcript
        sessionId="session-1"
        positions={[greeting]}
        botName="Seraphina"
        live={liveAttempt({ text: 'A' })}
        update={vi.fn(async () => undefined)}
        onAction={vi.fn()}
        regenerate={vi.fn()}
      />,
    );
    expect(request).toHaveBeenCalledTimes(1);

    view.rerender(
      <Transcript
        sessionId="session-1"
        positions={[greeting]}
        botName="Seraphina"
        live={liveAttempt({ text: 'A longer stream' })}
        update={vi.fn(async () => undefined)}
        onAction={vi.fn()}
        regenerate={vi.fn()}
      />,
    );
    expect(request).toHaveBeenCalledTimes(1);

    frames[0]?.(0);
    view.rerender(
      <Transcript
        sessionId="session-1"
        positions={[greeting]}
        botName="Seraphina"
        live={liveAttempt({ text: 'A longer streamed response' })}
        update={vi.fn(async () => undefined)}
        onAction={vi.fn()}
        regenerate={vi.fn()}
      />,
    );
    expect(request).toHaveBeenCalledTimes(2);
    request.mockRestore();
  });

  it.each([
    ['new reply', false],
    ['new reply', true],
    ['swipe', false],
    ['swipe', true],
  ] as const)(
    'preserves disclosure state through %s completion (manually closed: %s)',
    async (kind, close) => {
      const attempt = liveAttempt({
        positionId: kind === 'swipe' ? greeting.id : 'position-live',
      });
      const props = {
        sessionId: 'session-1',
        botName: 'Echo',
        update: vi.fn(),
        onAction: vi.fn(),
        regenerate: vi.fn(),
      };
      const view = render(
        <Transcript {...props} positions={[greeting]} live={attempt} />,
      );
      attempt.trace = [
        { type: 'reasoning', text: 'Considering the response.' },
        {
          type: 'tool',
          id: 'tool-1',
          name: 'mcp__weather__forecast',
          arguments: { city: 'Boston' },
          result: null,
          isError: false,
          startedAt: '2026-08-14T09:00:00.000Z',
          completedAt: null,
        },
      ];
      view.rerender(
        <Transcript {...props} positions={[greeting]} live={{ ...attempt }} />,
      );
      const toggle = screen.getByRole('button', { name: /Thinking/u });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(toggle);
      await userEvent.click(screen.getByText('mcp__weather__forecast'));
      if (close) await userEvent.click(toggle);

      const completed = {
        ...greeting,
        id: attempt.positionId,
        variant: {
          ...variant(attempt.variantId, 'The answer.'),
          trace: attempt.trace,
        },
      };
      const positions = kind === 'swipe' ? [completed] : [greeting, completed];
      // Admission's canonical page can land after the live row was appended.
      view.rerender(
        <Transcript
          {...props}
          positions={positions}
          live={{ ...attempt, text: 'The answer.' }}
        />,
      );
      expect(screen.getByRole('button', { name: /Thinking/u })).toBe(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', String(!close));
      view.rerender(
        <Transcript {...props} positions={positions} live={null} />,
      );
      expect(screen.getByRole('button', { name: /Thought/u })).toBe(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', String(!close));
      expect(document.querySelector('.is-live')).toBeNull();
      if (!close) {
        expect(screen.getByText('No result')).toBeVisible();
        expect(screen.getByText(/"Boston"/u)).toBeVisible();
      }
      // A subsequent swipe owns a fresh, closed disclosure.
      view.rerender(
        <Transcript
          {...props}
          positions={positions}
          live={{ ...attempt, variantId: 'next-variant' }}
        />,
      );
      expect(screen.getByRole('button', { name: /Thinking/u })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    },
  );

  it('exposes persisted reasoning on a completed variant', async () => {
    renderTranscript([
      {
        ...greeting,
        variant: variant('variant-a', 'Hello there.', 'I weighed the tone.'),
        variantCount: 1,
      },
    ]);
    const toggle = screen.getByRole('button', { name: /Thought/u });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByText('I weighed the tone.')).toBeInTheDocument();
  });

  it('renders persisted tool arguments and results on a completed variant', async () => {
    const completed = {
      ...variant('variant-a', 'The answer.'),
      trace: [
        {
          type: 'tool' as const,
          id: 'tool-1',
          name: 'mcp__weather__forecast',
          arguments: { city: 'Boston' },
          result: 'Sunny',
          isError: false,
          startedAt: '2026-08-14T09:00:00.000Z',
          completedAt: '2026-08-14T09:00:00.250Z',
        },
      ],
    };
    renderTranscript([{ ...greeting, variant: completed, variantCount: 1 }]);

    const disclosure = screen.getByRole('button', { name: /Used tools/u });
    await userEvent.click(disclosure);
    expect(screen.getByText('mcp__weather__forecast')).toBeInTheDocument();
    expect(screen.getByText('Done · 250ms')).toBeInTheDocument();
    await userEvent.click(screen.getByText('mcp__weather__forecast'));
    expect(screen.getByText(/"city": "Boston"/u)).toBeInTheDocument();
    expect(screen.getByText('Sunny')).toBeInTheDocument();
  });

  it('opens a shared editor without changing the message or its toolbar', async () => {
    renderTranscript([
      {
        id: 'position-1',
        ordinal: 1,
        role: 'user',
        source: 'Hi',
        attachments: [],
        createdAt: '2026-01-12T18:30:00.000Z',
      },
    ]);
    const row = document.querySelector('.msg-row.is-user');
    expect(row?.className).not.toContain('is-editing');
    await userEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(row?.className).not.toContain('is-editing');
    expect(within(screen.getByRole('dialog')).getByRole('textbox')).toHaveValue(
      'Hi',
    );
    expect(row?.querySelector('textarea')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Cancel editing' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Edit message' })).toHaveFocus();
  });

  it('divides the transcript on a calendar-day change, not per message', () => {
    renderTranscript([
      { ...greeting, createdAt: '2026-01-12T09:00:00.000Z' },
      {
        id: 'position-1',
        ordinal: 1,
        role: 'user',
        source: 'Still the same day.',
        attachments: [],
        createdAt: '2026-01-12T18:30:00.000Z',
      },
      {
        id: 'position-2',
        ordinal: 2,
        role: 'user',
        source: 'A new day.',
        attachments: [],
        createdAt: '2026-01-13T08:00:00.000Z',
      },
    ]);
    const dividers = document.querySelectorAll('.msg-day-divider');
    expect(dividers).toHaveLength(2);
    // The first divider dates the conversation's opening message.
    expect(dividers[0]?.textContent).toContain('January 12, 2026');
    expect(dividers[1]?.textContent).toContain('January 13, 2026');
  });

  it('renders operator text verbatim while the reply stays Markdown', () => {
    renderTranscript([
      {
        ...greeting,
        variant: variant('variant-a', '*She smiles.* "Hello."'),
      },
      {
        id: 'position-1',
        ordinal: 1,
        role: 'user',
        source: '*not emphasis* and `not code`',
        attachments: [],
        createdAt: '2026-08-14T09:01:00.000Z',
      },
    ]);

    // The operator's asterisks and backticks survive as the bots typed.
    const plain = document.querySelector('.msg-row.is-user .msg-plain');
    expect(plain?.textContent).toBe('*not emphasis* and `not code`');
    expect(document.querySelector('.msg-row.is-user em')).toBeNull();
    expect(document.querySelector('.msg-row.is-user code')).toBeNull();

    // The bot's reply keeps narration and dialogue highlighting.
    expect(document.querySelector('.msg-row.is-assistant em')).not.toBeNull();
    expect(
      document.querySelector('.msg-row.is-assistant .msg-dialogue'),
    ).not.toBeNull();
  });

  it('renders a trailing system error inside its canonical response', () => {
    renderTranscript([
      {
        ...greeting,
        variant: variant(
          'variant-a',
          'Partial answer.\n<system_error>Provider &amp; model failed.</system_error>',
        ),
      },
    ]);
    expect(screen.getByText('Partial answer.')).toBeInTheDocument();
    expect(screen.getByText('Provider & model failed.')).toHaveClass(
      'ui-hint is-error',
    );
    expect(
      screen.queryByRole('button', { name: 'Play message' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the user edit affordance out of the bubble surface', () => {
    renderTranscript([
      {
        id: 'position-1',
        ordinal: 1,
        role: 'user',
        source: 'Good morning.',
        attachments: [],
        createdAt: '2026-08-14T09:01:00.000Z',
      },
    ]);
    const row = document.querySelector('.msg-row.is-user');
    const surface = row?.querySelector('.msg-surface');
    expect(surface).not.toBeNull();
    expect(
      within(surface as HTMLElement).queryByRole('button', {
        name: 'Edit message',
      }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit message' }),
    ).toBeInTheDocument();
  });

  it('reads a scheduled occurrence back out instead of showing its element', () => {
    renderTranscript([
      {
        id: 'position-1',
        ordinal: 1,
        role: 'user',
        source: [
          '<scheduled_event name="Nightly check-in" ran_at="2026-08-14T21:00:00.000Z">',
          'Ask how the day went &amp; what tomorrow holds.',
          '</scheduled_event>',
        ].join('\n'),
        attachments: [],
        createdAt: '2026-08-14T21:00:00.000Z',
      },
    ]);
    const row = document.querySelector('.msg-row.is-scheduled');
    expect(row).not.toBeNull();
    // The stored element is what the model answered; the transcript shows the
    // occurrence and its prompt, with no markup and no escaped entities.
    expect(row?.textContent).not.toContain('scheduled_event');
    expect(row?.textContent).not.toContain('&amp;');
    expect(screen.getByText('Nightly check-in')).toBeInTheDocument();
    expect(
      screen.getByText('Ask how the day went & what tomorrow holds.'),
    ).toBeInTheDocument();
  });
});

it('keeps the opened variant as the save target when the selected variant refreshes', async () => {
  const user = userEvent.setup();
  const update = vi.fn<TranscriptUpdate>(async () => undefined);
  const props = {
    sessionId: 'session-1',
    ttsConfigured: false,
    botName: 'Echo',
    update,
    regenerate: vi.fn(),
    onAction: vi.fn(),
    busy: false,
  };
  const { rerender } = render(
    <AssistantMessageRow {...props} position={greeting} />,
  );
  await user.click(screen.getByRole('button', { name: 'Edit message' }));
  const input = screen.getByRole('textbox');
  await user.clear(input);
  await user.type(input, 'Edited original');
  rerender(
    <AssistantMessageRow
      {...props}
      position={{
        ...greeting,
        variant: variant('variant-b', 'Different response'),
      }}
    />,
  );
  expect(input).toHaveValue('Edited original');
  await user.click(
    screen.getByRole('button', { name: 'Save message changes' }),
  );
  expect(update).toHaveBeenCalledWith('/variants/variant-a/source', 'PATCH', {
    source: 'Edited original',
  });
});
