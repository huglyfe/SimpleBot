import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '@simplebot/shared';

import { TimePreferences } from '../../lib/format.js';
import { ConversationSheet } from './ConversationSheet.js';

const api = vi.hoisted(() => ({
  saveTodo: vi.fn(),
  deleteTodo: vi.fn(),
  compactSession: vi.fn(),
  deleteSchedule: vi.fn(),
  deleteVariable: vi.fn(),
  editLeafSource: vi.fn(),
  getContext: vi.fn(),
  putSchedule: vi.fn(),
  regenerateLeaf: vi.fn(),
  setVariable: vi.fn(),
}));

vi.mock('../../api.js', () => api);

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const POSITION_ID = '00000000-0000-4000-8000-000000000003';
const LEAF_ID = '00000000-0000-4000-8000-000000000006';

const context: SessionContext = {
  timezone: 'America/New_York',
  leaves: [],
  lastRequestUsage: {
    input: 120,
    output: 30,
    cacheRead: 600,
    cacheWrite: 280,
    totalTokens: 1_030,
    cost: {
      input: 0.002,
      output: 0.001,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0.003,
    },
  },
  lastSwipeCost: 0.0125,
  exactFromExchange: 1,
  currentExchange: 2,
  canCompact: true,
  todos: [],
  variables: [],
  schedules: [
    {
      id: '00000000-0000-4000-8000-000000000005',
      name: 'Morning hello',
      expression: '0 9 * * *',
      prompt: 'Say good morning.',
      enabled: true,
      nextRunAt: '2026-08-24T13:00:00.000Z',
      nextRunError: null,
    },
  ],
};

function change(name: string, value: string): SessionContext {
  return {
    ...context,
    variables: [
      {
        name,
        value,
      },
    ],
  };
}

function renderSheet() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TimePreferences
        value={{ timezone: context.timezone, clockFormat: '24' }}
      >
        <ConversationSheet sessionId={SESSION_ID} />
      </TimePreferences>
    </QueryClientProvider>,
  );
  return { client };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getContext.mockResolvedValue(context);
});

describe('ConversationSheet', () => {
  it('shows prompt cache hits and misses without a disclosure', async () => {
    renderSheet();

    expect(
      await screen.findByText('1,000 input · 30 output'),
    ).toBeInTheDocument();
    expect(screen.getByText('Prompt cache')).toBeVisible();
    expect(screen.getByText('600 hit · 400 miss')).toBeVisible();
    expect(screen.queryByText('Total tokens')).not.toBeInTheDocument();
    const facts = screen.getByText('Last request tokens').closest('dl');
    expect(
      Array.from(facts?.querySelectorAll('dt') ?? []).map(
        (label) => label.textContent,
      ),
    ).toEqual([
      'Last request tokens',
      'Prompt cache',
      'Last message cost',
      'Current exchange',
      'Exact context begins',
    ]);
    expect(screen.queryByText('Token breakdown')).not.toBeInTheDocument();
  });

  it('shows Unavailable rather than zero when message cost is missing', async () => {
    api.getContext.mockResolvedValue({
      ...context,
      lastRequestUsage: null,
      lastSwipeCost: null,
    } satisfies SessionContext);
    renderSheet();

    expect(await screen.findByText('Usage unavailable')).toBeInTheDocument();
    expect(screen.getByText('Last message cost')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it.each([
    [0, '$0.00'],
    [0.0004, '$0.0004'],
    [0.0125, '$0.01'],
  ])('shows reported message cost %s as %s', async (cost, expected) => {
    api.getContext.mockResolvedValue({
      ...context,
      lastSwipeCost: cost,
    } satisfies SessionContext);
    renderSheet();

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('shows stored Context facts and disables Compact now while it runs', async () => {
    const next: SessionContext = {
      ...context,
      leaves: [
        {
          id: '00000000-0000-4000-8000-000000000006',
          triggerPositionId: POSITION_ID,
          startOrdinal: 0,
          endOrdinal: 0,
          startExchange: 1,
          endExchange: 1,
          createdAt: '2026-08-23T12:02:00.000Z',
          state: 'committed',
          summary: 'Earlier events.',
          summaryOutcome: 'model',
        },
      ],
      canCompact: false,
    };
    api.getContext.mockResolvedValueOnce(context).mockResolvedValueOnce(next);
    const compaction = Promise.withResolvers<undefined>();
    api.compactSession.mockReturnValueOnce(compaction.promise);
    const { client } = renderSheet();

    expect(
      await screen.findByText('1,000 input · 30 output'),
    ).toBeInTheDocument();
    expect(screen.getByText('Exchange 2')).toBeInTheDocument();
    expect(screen.getByText('Exchange 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Compact now' }));

    expect(api.compactSession).toHaveBeenCalledWith(SESSION_ID);
    expect(screen.getByRole('button', { name: 'Compact now' })).toBeDisabled();
    expect(
      screen.queryByText('Compaction in progress'),
    ).not.toBeInTheDocument();
    compaction.resolve(undefined);
    await waitFor(() => {
      expect(client.getQueryData(['context', SESSION_ID])).toEqual(next);
    });
    expect(screen.getByText('Earlier events.')).toBeInTheDocument();
  });

  it('uses human leaf outcomes and disables compaction without eligible history', async () => {
    api.getContext.mockResolvedValue({
      ...context,
      canCompact: false,
      leaves: [
        {
          id: LEAF_ID,
          triggerPositionId: POSITION_ID,
          startOrdinal: 0,
          endOrdinal: 1,
          startExchange: 1,
          endExchange: 1,
          createdAt: '2026-08-23T12:02:00.000Z',
          state: 'committed',
          summary: 'Earlier events.',
          summaryOutcome: 'model',
        },
      ],
    } satisfies SessionContext);
    renderSheet();

    expect(await screen.findByText('Earlier events.')).toBeInTheDocument();
    expect(screen.queryByText('model')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compact now' })).toBeDisabled();
  });

  it('lists summary exchange ranges and opens only the selected editor', async () => {
    const olderId = '00000000-0000-4000-8000-000000000007';
    api.getContext.mockResolvedValue({
      ...context,
      leaves: [
        {
          id: LEAF_ID,
          triggerPositionId: POSITION_ID,
          startOrdinal: 4,
          endOrdinal: 7,
          startExchange: 3,
          endExchange: 4,
          createdAt: '2026-08-23T12:03:00.000Z',
          state: 'committed',
          summary: 'Most recent events.',
          summaryOutcome: 'model',
        },
        {
          id: olderId,
          triggerPositionId: POSITION_ID,
          startOrdinal: 0,
          endOrdinal: 3,
          startExchange: 1,
          endExchange: 2,
          createdAt: '2026-08-23T12:02:00.000Z',
          state: 'committed',
          summary: 'Earlier events.',
          summaryOutcome: 'model',
        },
      ],
    } satisfies SessionContext);
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('button', { name: 'Edit summary · Exchanges 3–4' });
    expect(screen.getByText('Most recent events.')).toBeInTheDocument();
    expect(screen.getByText('Earlier events.')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Edit summary · Exchanges 1–2' }),
    );
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue(
      'Earlier events.',
    );
  });

  it.each(['Corrected events.', ''])(
    'saves summary text %j',
    async (source) => {
      const originalLeaf: SessionContext['leaves'][number] = {
        id: LEAF_ID,
        triggerPositionId: POSITION_ID,
        startOrdinal: 0,
        endOrdinal: 1,
        startExchange: 1,
        endExchange: 1,
        createdAt: '2026-08-23T12:02:00.000Z',
        state: 'committed',
        summary: 'Earlier events.',
        summaryOutcome: 'fallback-unavailable',
      };
      api.getContext
        .mockResolvedValueOnce({ ...context, leaves: [originalLeaf] })
        .mockResolvedValueOnce({
          ...context,
          leaves: [{ ...originalLeaf, summary: source }],
        });
      api.editLeafSource.mockResolvedValue(undefined);
      renderSheet();

      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Edit summary · Exchange 1',
        }),
      );
      const editor = screen.getByRole('textbox', { name: 'Summary' });
      await userEvent.clear(editor);
      if (source) await userEvent.type(editor, source);
      await userEvent.click(
        screen.getByRole('button', { name: 'Save summary' }),
      );

      expect(api.editLeafSource).toHaveBeenCalledWith(
        SESSION_ID,
        LEAF_ID,
        source,
      );
      expect(
        await screen.findByText(source || 'Empty summary'),
      ).toBeInTheDocument();
    },
  );

  it('locks summary editing during regeneration and unlocks after success or failure', async () => {
    const leaf: SessionContext['leaves'][number] = {
      id: LEAF_ID,
      triggerPositionId: POSITION_ID,
      startOrdinal: 0,
      endOrdinal: 1,
      startExchange: 1,
      endExchange: 1,
      createdAt: '2026-08-23T12:02:00.000Z',
      state: 'committed',
      summary: '[Summary unavailable. Retrieve details if needed.]',
      summaryOutcome: 'fallback-unavailable',
    };
    const regenerated = {
      ...context,
      leaves: [{ ...leaf, summary: 'Fresh events.', summaryOutcome: 'model' }],
    } satisfies SessionContext;
    api.getContext
      .mockResolvedValueOnce({ ...context, leaves: [leaf] })
      .mockResolvedValue(regenerated);
    const call = Promise.withResolvers<undefined>();
    const failedCall = Promise.withResolvers<undefined>();
    api.regenerateLeaf
      .mockReturnValueOnce(call.promise)
      .mockReturnValueOnce(failedCall.promise);
    renderSheet();
    const regenerate = await screen.findByRole('button', {
      name: 'Regenerate summary · Exchange 1',
    });
    const edit = screen.getByRole('button', {
      name: 'Edit summary · Exchange 1',
    });

    await userEvent.click(regenerate);
    expect(api.regenerateLeaf).toHaveBeenCalledWith(SESSION_ID, LEAF_ID);
    expect(regenerate).toBeDisabled();
    expect(edit).toBeDisabled();
    await userEvent.click(edit);
    expect(screen.queryByRole('textbox', { name: 'Summary' })).toBeNull();
    call.resolve(undefined);
    expect(await screen.findByText('Fresh events.')).toBeInTheDocument();
    expect(
      screen.queryByText('Fallback summary — model unavailable'),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(regenerate).toBeEnabled());
    expect(edit).toBeEnabled();

    await userEvent.click(regenerate);
    expect(edit).toBeDisabled();
    failedCall.reject(new Error('provider unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'provider unavailable',
    );
    expect(screen.getByText('Fresh events.')).toBeInTheDocument();
    expect(regenerate).toBeEnabled();
    expect(edit).toBeEnabled();
    await userEvent.click(edit);
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue(
      'Fresh events.',
    );
  });

  it('shows stored schedules and their next run', async () => {
    renderSheet();

    expect(
      await screen.findByText(/0 9 \* \* \* · enabled/),
    ).toBeInTheDocument();
    expect(screen.getByText('Say good morning.')).toBeInTheDocument();
    expect(screen.getByText(/Next run .*09:00/u)).toBeInTheDocument();
  });

  it('replaces Context after a direct variable write', async () => {
    api.getContext
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce(change('mood', 'calm'));
    api.setVariable.mockResolvedValue(undefined);
    renderSheet();
    await screen.findByText('Context status');
    await userEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    await userEvent.type(screen.getByLabelText('Variable name'), 'mood');
    await userEvent.type(screen.getByLabelText('Value'), 'calm');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create variable' }),
    );

    expect(api.setVariable).toHaveBeenCalledWith(
      SESSION_ID,
      'mood',
      'calm',
      undefined,
    );
    expect(await screen.findByText('mood')).toBeInTheDocument();
    expect(screen.getByText('calm')).toBeInTheDocument();
  });

  it('renames a variable with one atomic write', async () => {
    const original = change('mood', 'calm');
    api.getContext
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(change('feeling', 'calm'));
    api.setVariable.mockResolvedValue(undefined);
    renderSheet();
    await screen.findByText('Context status');
    await userEvent.click(
      await screen.findByRole('button', { name: /^Edit variable/u }),
    );
    const name = screen.getByLabelText('Variable name');
    await userEvent.clear(name);
    await userEvent.type(name, 'feeling');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save variable' }),
    );

    expect(api.setVariable).toHaveBeenCalledWith(
      SESSION_ID,
      'feeling',
      'calm',
      'mood',
    );
    expect(api.deleteVariable).not.toHaveBeenCalled();
    expect(await screen.findByText('feeling')).toBeInTheDocument();
  });

  it('reports a successful write and failed Context refresh separately', async () => {
    api.getContext
      .mockResolvedValueOnce(context)
      .mockRejectedValueOnce(new Error('Connection lost'));
    api.setVariable.mockResolvedValue(undefined);
    renderSheet();
    await screen.findByText('Context status');
    await userEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    await userEvent.type(screen.getByLabelText('Variable name'), 'mood');
    await userEvent.type(screen.getByLabelText('Value'), 'calm');
    await userEvent.click(
      screen.getByRole('button', { name: 'Create variable' }),
    );

    expect(
      await screen.findByText(
        'Saved, but Context could not refresh: Connection lost',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument();
  });
});
