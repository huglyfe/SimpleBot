import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_DEFAULTS,
  presetSchema,
  type Bootstrap,
} from '@simplebot/shared';

import { RequestError } from '../../api.js';
import { SettingsPanel, type Panel } from './SettingsPanel.js';

const api = vi.hoisted(() => ({
  getBotDocument: vi.fn(),
  getPresetDocument: vi.fn(),
  getCapabilities: vi.fn(),
  getContext: vi.fn(),
  getPresetList: vi.fn(),
  getProviderList: vi.fn(),
  getProviderModels: vi.fn(),
  getSettings: vi.fn(),
  purgeOtherLogins: vi.fn(),
  saveAuthoredDocument: vi.fn(),
  saveSettings: vi.fn(),
  setSessionPreset: vi.fn(),
}));

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  getSecrets: async () => ({ names: [], revision: 'empty' }),
  ...api,
}));

const SESSION: Bootstrap['sessions'][number] = {
  id: '00000000-0000-4000-8000-000000000001',
  botSlug: 'seraphina',
  presetSlug: 'default',
  title: 'Hello',
  updatedAt: '2026-08-23T12:00:00.000Z',
};

function renderPanel(
  panel: Panel,
  session?: Bootstrap['sessions'][number],
  onClose = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsPanel
        panel={panel}
        bots={[]}
        version="0.10.0"
        ttsConfigured={false}
        session={session}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return client;
}

function renderProviders() {
  return renderPanel({ section: 'providers' });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.setSessionPreset.mockResolvedValue(undefined);
  api.getSettings.mockResolvedValue({
    value: {
      application: APPLICATION_DEFAULTS,
      providers: { openrouter: { apiKey: '${OPENROUTER_API_KEY}' } },
      tts: null,
    },
    revision: 'config-1',
  });
  api.getProviderList.mockResolvedValue([
    { id: 'openrouter', name: 'OpenRouter' },
  ]);
  api.getProviderModels
    .mockResolvedValueOnce({ models: [], error: 'Old connection failed' })
    .mockResolvedValue({ models: [], error: null });
  api.getPresetList.mockResolvedValue([
    { slug: 'default', model: 'a/b' },
    { slug: 'terse', model: 'a/c' },
  ]);
  api.saveSettings.mockResolvedValue('config-2');
  api.getBotDocument.mockResolvedValue({
    value: {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: { name: 'Seraphina', first_mes: 'Hello.' },
    },
    revision: 'card-1',
  });
  api.getPresetDocument.mockResolvedValue({
    value: presetSchema.parse({
      mainModel: { provider: 'openrouter', model: 'a/b' },
      persona: { name: 'Alex', description: '' },
      prompts: { system: '', instructions: '' },
    }),
    revision: 'preset-1',
  });
  api.getCapabilities.mockResolvedValue({ dependencies: [], capabilities: [] });
  api.getContext.mockReturnValue(new Promise(() => undefined));
  api.saveAuthoredDocument.mockResolvedValue('config-2');
});

vi.mock('../../auth.js', () => ({
  useAuth: () => ({ authenticated: true, loginEnabled: true, logout: vi.fn() }),
}));

describe('SettingsPanel provider save', () => {
  it('refreshes provider model evidence after settings save', async () => {
    const user = userEvent.setup();
    renderProviders();
    await user.click(
      await screen.findByRole('button', { name: 'Edit openrouter' }),
    );

    expect(
      await screen.findByText('Old connection failed'),
    ).toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText('Provider default'),
      'https://example.com',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(api.saveSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.getProviderModels).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit openrouter' }),
      ).toHaveTextContent('https://example.com · 0 models'),
    );
    expect(screen.queryByText('Old connection failed')).not.toBeInTheDocument();
  });

  it('retains failed panel saves and staged provider edits', async () => {
    const user = userEvent.setup();
    api.saveSettings.mockRejectedValueOnce(
      new RequestError('Configuration changed on disk', 409),
    );
    renderProviders();
    await user.click(
      await screen.findByRole('button', { name: 'Edit openrouter' }),
    );
    await user.type(
      screen.getByPlaceholderText('Provider default'),
      'https://local.example',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(api.saveSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Configuration changed on disk',
    );
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit openrouter' }));
    expect(screen.getByPlaceholderText('Provider default')).toHaveValue(
      'https://local.example',
    );
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsPanel owned projections', () => {
  it('confirms discarding a dirty preset before switching without writing', async () => {
    const user = userEvent.setup();
    renderPanel({ section: 'preset' }, SESSION);
    await user.type(await screen.findByLabelText('Name'), ' edited');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Preset' }));
    await user.click(await screen.findByRole('button', { name: /terse/ }));
    expect(api.saveAuthoredDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Unsaved changes',
    );
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Discard',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(api.setSessionPreset).toHaveBeenCalledWith(SESSION.id, 'terse');
  });

  it('retains the draft and current preset when a confirmed switch fails', async () => {
    api.setSessionPreset.mockRejectedValueOnce(new Error('Selection refused'));
    const user = userEvent.setup();
    renderPanel({ section: 'preset' }, SESSION);
    await user.type(await screen.findByLabelText('Name'), ' edited');
    const draft = screen.getByLabelText('Name');
    await user.click(screen.getByRole('button', { name: 'Preset' }));
    await user.click(await screen.findByRole('button', { name: /terse/ }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Selection refused',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(draft).toHaveValue('Alex edited');
    expect(screen.getByRole('button', { name: 'Preset' })).toHaveTextContent(
      'default',
    );
    expect(api.saveAuthoredDocument).not.toHaveBeenCalled();
    expect(api.setSessionPreset).toHaveBeenCalledTimes(1);
  });

  it('loads configured providers when opening the preset editor', async () => {
    renderPanel({ section: 'preset' }, SESSION);

    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });
});

describe('Browser login actions', () => {
  it('warns simply before purging and preserves a failed action without retry', async () => {
    const user = userEvent.setup();
    api.purgeOtherLogins.mockRejectedValueOnce(
      new Error('Could not revoke logins'),
    );
    renderPanel({ section: 'application' });
    await screen.findByRole('button', { name: 'Log out' });
    await user.click(
      screen.getByRole('button', { name: 'Purge other logins' }),
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Other browsers will be logged out. This browser stays logged in.',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Purge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not revoke logins',
    );
    expect(api.purgeOtherLogins).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

it('offers Cancel, Discard, and Save only when leaving a dirty panel', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  renderPanel({ section: 'providers' }, undefined, close);
  await user.click(
    await screen.findByRole('button', { name: 'Edit openrouter' }),
  );
  await user.type(
    screen.getByPlaceholderText('Provider default'),
    'https://draft.example',
  );
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(api.saveSettings).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Close panel' }));
  let popup = screen.getByRole('alertdialog');
  expect(
    within(popup)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Cancel', 'Discard', 'Save']);
  await user.click(within(popup).getByRole('button', { name: 'Cancel' }));
  expect(close).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Edit openrouter' }),
  ).toHaveTextContent('https://draft.example');
  await user.click(screen.getByRole('button', { name: 'Close panel' }));
  popup = screen.getByRole('alertdialog');
  await user.click(within(popup).getByRole('button', { name: 'Discard' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(api.saveSettings).not.toHaveBeenCalled();
});

it('keeps a failed popup save open with its draft, then leaves after a successful save', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  api.saveSettings.mockRejectedValueOnce(new Error('Disk unavailable'));
  renderPanel({ section: 'application' }, undefined, close);
  await user.click(await screen.findByRole('radio', { name: 'Off' }));
  await user.click(screen.getByRole('button', { name: 'Close panel' }));
  const popup = screen.getByRole('alertdialog');
  await user.click(within(popup).getByRole('button', { name: 'Save' }));
  expect(await within(popup).findByRole('alert')).toHaveTextContent(
    'Disk unavailable',
  );
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Off')).toBeChecked();
  await user.click(within(popup).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(api.saveSettings).toHaveBeenCalledTimes(2);
});

it('Discard resets configuration and appearance without writing or leaving the panel', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  renderPanel({ section: 'application' }, undefined, close);
  await user.click(await screen.findByRole('radio', { name: 'Off' }));
  await user.click(screen.getByRole('radio', { name: 'Dark' }));
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('radio', { name: 'Required' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus();
  expect(close).not.toHaveBeenCalled();
  expect(api.saveSettings).not.toHaveBeenCalled();
});

it('preset-switch Save rejects a native-invalid draft before making a write', async () => {
  const user = userEvent.setup();
  renderPanel({ section: 'preset' }, SESSION);
  await user.clear(
    await screen.findByLabelText('Compaction threshold (tokens)'),
  );
  await user.type(screen.getByLabelText('Compaction threshold (tokens)'), '-1');
  await user.click(screen.getByRole('button', { name: 'Preset' }));
  await user.click(await screen.findByRole('button', { name: /terse/ }));
  const popup = screen.getByRole('alertdialog');
  await user.click(within(popup).getByRole('button', { name: 'Save' }));
  expect(await within(popup).findByRole('alert')).toHaveTextContent(
    'valid values',
  );
  expect(api.saveAuthoredDocument).not.toHaveBeenCalled();
});

it('finishes a provider save and adopts its revision while list refreshes are pending', async () => {
  const user = userEvent.setup();
  const client = renderProviders();
  const pending = Promise.withResolvers<undefined>();
  const invalidate = vi
    .spyOn(client, 'invalidateQueries')
    .mockReturnValue(pending.promise);
  await user.click(
    await screen.findByRole('button', { name: 'Edit openrouter' }),
  );
  await user.type(
    screen.getByPlaceholderText('Provider default'),
    'https://saved.example',
  );
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
  );
  expect(
    screen.getByRole('button', { name: 'Edit openrouter' }).closest('fieldset'),
  ).not.toHaveAttribute('inert');
  expect(invalidate).toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Edit openrouter' }));
  await user.type(screen.getByPlaceholderText('Provider default'), '/v2');
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2));
  expect(api.saveSettings.mock.calls[1]?.[1]).toBe('config-2');
  pending.resolve(undefined);
});

it('keeps clock format in General and saves or discards through the existing settings draft', async () => {
  const user = userEvent.setup();
  renderPanel({ section: 'application' });
  const twelve = await screen.findByRole('radio', { name: '12-hour' });
  expect(screen.getByRole('radio', { name: '24-hour' })).toBeChecked();
  await user.click(twelve);
  expect(api.saveSettings).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('radio', { name: '24-hour' })).toBeChecked();
  await user.click(twelve);
  await user.click(screen.getByRole('button', { name: /^Save$/u }));
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        application: { ...APPLICATION_DEFAULTS, clockFormat: '12' },
      }),
      'config-1',
    ),
  );
  expect(twelve).toBeChecked();
});
