import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settingsDocumentSchema } from '@simplebot/shared';

import { ProviderSheet } from './ProviderSheet.js';

const { getProviderList, getProviderModels } = vi.hoisted(() => ({
  getProviderList: vi.fn(),
  getProviderModels: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  getProviderList,
  getProviderModels,
  getSecrets: async () => ({ names: [], revision: 'empty' }),
}));

function renderSheet(value: Record<string, unknown>) {
  const saved = settingsDocumentSchema.parse({
    value: { application: {}, ...value },
    revision: 'test',
  }).value;
  const patch = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProviderSheet saved={saved.providers} value={saved} patch={patch} />
    </QueryClientProvider>,
  );
  return patch;
}

beforeEach(() => {
  vi.clearAllMocks();
  getProviderList.mockResolvedValue([
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'anthropic', name: 'Anthropic' },
  ]);
  getProviderModels.mockResolvedValue({ models: [], error: null });
});

describe('ProviderSheet', () => {
  it('shows the URL and model count on the item without opening its editor', async () => {
    getProviderModels.mockResolvedValue({
      models: [{ id: 'model-a' }],
      error: null,
    });
    renderSheet({
      providers: {
        openrouter: {},
        anthropic: { baseUrl: 'https://models.example/v1' },
      },
      tts: null,
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit openrouter' }),
      ).toHaveTextContent('Default URL · 1 model'),
    );
    expect(
      screen.getByRole('button', { name: 'Edit anthropic' }),
    ).toHaveTextContent('https://models.example/v1 · 1 model');
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit openrouter' }),
    );
    expect(screen.queryByText('Connection')).not.toBeInTheDocument();
    expect(getProviderModels).toHaveBeenCalledTimes(2);
  });

  it('replaces last-known counts with an explicit refresh failure', async () => {
    getProviderModels.mockResolvedValue({
      models: [{ id: 'one' }, { id: 'two' }],
      error: 'Catalog refresh failed',
    });
    renderSheet({ providers: { openrouter: {} }, tts: null });
    const item = screen.getByRole('button', { name: 'Edit openrouter' });
    await waitFor(() =>
      expect(item).toHaveTextContent('Default URL · Catalog unavailable'),
    );
    expect(item).toHaveTextContent('Catalog refresh failed');
    expect(item).not.toHaveTextContent('2 models');
  });

  it('does not turn a missing catalog into zero available models', async () => {
    getProviderModels.mockRejectedValue(new Error('Network unavailable'));
    renderSheet({ providers: { openrouter: {} }, tts: null });
    const item = screen.getByRole('button', { name: 'Edit openrouter' });
    await waitFor(() => expect(item).toHaveTextContent('Catalog unavailable'));
    expect(item).not.toHaveTextContent('0 models');
    expect(item).toHaveTextContent('Network unavailable');
  });

  it('displays exact environment references without resolving secrets', async () => {
    renderSheet({
      providers: { openrouter: { apiKey: '${OPENROUTER_API_KEY}' } },
      tts: null,
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit openrouter' }),
    );
    expect(
      await screen.findByDisplayValue('${OPENROUTER_API_KEY}'),
    ).toBeVisible();
    expect(screen.queryByText('Use ${NAME}')).not.toBeInTheDocument();
  });

  it('adds another configured provider without replacing existing entries', async () => {
    const user = userEvent.setup();
    const patch = renderSheet({ providers: { openrouter: {} }, tts: null });

    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Add provider' })).getByRole(
        'button',
        { name: 'Add provider' },
      ),
    );
    await user.click(await screen.findByRole('button', { name: /Anthropic/ }));

    expect(patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(patch).toHaveBeenCalledWith('providers', {
      openrouter: {},
      anthropic: {},
    });
  });

  it('opens speech as a local draft and applies it only on Done', async () => {
    const patch = renderSheet({ providers: {}, tts: null });

    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add speech connection' }),
    );
    expect(await screen.findByLabelText('Base URL')).toHaveValue('');
    expect(screen.getByLabelText('API key reference')).toHaveValue('');
    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Configure speech' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove speech connection' }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://speech.test' },
    });

    expect(patch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(patch).toHaveBeenCalledWith(
      'tts',
      expect.objectContaining({
        baseUrl: 'https://speech.test',
        timeoutMs: 60_000,
      }),
    );
  });

  it('keeps the remove action for a configured speech connection', async () => {
    const user = userEvent.setup();
    const patch = renderSheet({
      providers: {},
      tts: {
        baseUrl: 'https://speech.test',
        apiKey: '${SPEECH_API_KEY}',
        model: 'voice',
      },
    });

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove speech connection',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith('tts', null);
  });
});

it('does not discover models for a newly staged connection', async () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ProviderSheet
        saved={{}}
        value={{
          providers: { openrouter: { baseUrl: 'https://unsaved.example' } },
          tts: null,
        }}
        patch={vi.fn()}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole('button', { name: 'Edit openrouter' }),
  ).toHaveTextContent('Unsaved');
  expect(getProviderModels).not.toHaveBeenCalled();
});
