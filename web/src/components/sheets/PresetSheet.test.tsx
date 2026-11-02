import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Sheet } from '../primitives/Sheet.js';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { presetSchema } from '@simplebot/shared';

import { RequestError } from '../../api.js';
import { PresetSheet } from './PresetSheet.js';

const BASE_PRESET = presetSchema.parse({
  mainModel: { provider: 'openrouter', model: 'a/b' },
  persona: { name: 'Alex', description: '' },
  prompts: { system: '', instructions: '' },
  tts: { voice: 'af_alloy', speed: 1 },
});

type SavePreset = (
  path: string,
  value: Record<string, unknown>,
  revision: string,
) => Promise<string>;

const { getPresetDocument, getPresetList, getProviderModels, getSettings } =
  vi.hoisted(() => ({
    getPresetDocument: vi.fn(),
    getPresetList: vi.fn(),
    getProviderModels: vi.fn(),
    getSettings: vi.fn(),
  }));

// The real module still supplies `RequestError`: the sheet reads a refusal's
// status off it, so a stand-in class would prove nothing about the real one.
vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  getPresetDocument,
  getPresetList,
  getProviderModels,
  getSettings,
}));

function renderSheet(
  onSelectPreset = vi.fn(),
  save = vi.fn<SavePreset>(() => Promise.resolve('preset-2')),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Sheet title="Preset" label="Preset settings" onClose={() => undefined}>
        <PresetSheet
          slug="default"
          onSelectPreset={onSelectPreset}
          save={save}
          ttsConfigured
        />
      </Sheet>
    </QueryClientProvider>,
  );
  return { onSelectPreset, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({ value: { providers: { openrouter: {} } } });
  getPresetList.mockResolvedValue([
    { slug: 'default', model: 'a/b' },
    { slug: 'terse', model: 'a/c' },
  ]);
  getProviderModels.mockResolvedValue({
    models: [
      {
        id: 'a/b',
        name: 'Model B',
        reasoning: true,
        images: false,
        contextWindow: 200_000,
      },
      {
        id: 'a/c',
        name: 'Model C',
        reasoning: false,
        images: true,
        contextWindow: 1_000_000,
      },
    ],
    error: null,
  });
  getPresetDocument.mockResolvedValue({
    value: {
      ...BASE_PRESET,
      mainModel: { provider: 'openrouter', model: 'a/b' },
      persona: { name: 'Alex', description: '' },
      tts: { voice: 'af_alloy', speed: 1 },
    },
    revision: 'preset-1',
  });
});

describe('PresetSheet', () => {
  it('offers the presets on disk and switches to the chosen one', async () => {
    const user = userEvent.setup();
    const { onSelectPreset } = renderSheet();

    await user.click(await screen.findByRole('button', { name: 'Preset' }));
    await user.click(await screen.findByRole('button', { name: /terse/ }));

    expect(onSelectPreset).toHaveBeenCalledWith('terse');
  });

  it('retains the selected preset when its list is unavailable', async () => {
    getPresetList.mockRejectedValue(new Error('Offline'));
    renderSheet();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Preset list unavailable.',
    );
    expect(screen.getByRole('button', { name: 'Preset' })).toHaveTextContent(
      'default',
    );
  });

  it('searches the provider catalog for the model instead of asking for an id', async () => {
    const user = userEvent.setup();
    renderSheet();

    const model = await screen.findByRole('button', { name: 'Main model' });
    await user.click(model);
    await user.type(screen.getByRole('searchbox'), 'Model C');

    // The catalog is searched, not typed from memory: the match ranks first.
    // Options re-rank on every keystroke, so settle before reading them.
    await waitFor(() => {
      expect(
        within(
          screen.getByRole('group', { name: 'Main model choices' }),
        ).getByRole('button', { name: /Model C.*1000k/ }),
      ).toHaveTextContent('Model C');
    });
    expect(
      within(
        screen.getByRole('group', { name: 'Main model choices' }),
      ).getByRole('button', { name: /Model C.*1000k/ }),
    ).toHaveTextContent('1000k context');
  });

  it('stages separate prompt edits and saves them with the panel draft', async () => {
    const user = userEvent.setup();
    const save = vi.fn<SavePreset>().mockResolvedValue('preset-2');
    renderSheet(vi.fn(), save);
    await user.type(await screen.findByLabelText('Name'), ' edited');

    await user.click(
      await screen.findByRole('button', { name: 'Edit System' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'System' }),
      'Stay in bot.',
    );
    expect(
      screen.queryByRole('textbox', { name: 'Instructions' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Edit Instructions' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Instructions' }),
      'Keep responses concise.',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Edit System' }));
    expect(screen.getByRole('textbox', { name: 'System' })).toHaveValue(
      'Stay in bot.',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      'presets/default',
      expect.objectContaining({
        persona: { name: 'Alex edited', description: '' },
        prompts: {
          ...BASE_PRESET.prompts,
          system: 'Stay in bot.',
          instructions: 'Keep responses concise.',
        },
      }),
      'preset-1',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('uses one summary-model toggle and reveals the existing picker when off', async () => {
    const user = userEvent.setup();
    renderSheet();

    const reuse = await screen.findByRole('checkbox', {
      name: 'Use main model for summaries',
    });
    expect(reuse).toBeChecked();
    expect(
      screen.queryByRole('button', { name: 'Summary model' }),
    ).not.toBeInTheDocument();

    await user.click(reuse);
    expect(reuse).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Summary model' }),
    ).toHaveTextContent('Model B');
  });

  it('creates a preset from the current draft under a valid new name', async () => {
    const user = userEvent.setup();
    const save = vi.fn<SavePreset>(() => Promise.resolve('evening'));
    const onSelectPreset = vi.fn();
    renderSheet(onSelectPreset, save);

    await user.clear(await screen.findByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Evening Alex');
    expect(screen.queryByLabelText('Preset name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preset actions' }));
    const createPreset = screen.getByRole('menuitem', { name: 'Clone preset' });
    expect(createPreset.closest('.settings-section')).toHaveTextContent(
      'Preset',
    );
    await user.click(createPreset);
    await user.type(screen.getByLabelText('Preset name'), 'evening');
    await user.click(screen.getByRole('button', { name: 'Clone' }));

    const [path, value, revision] = save.mock.calls.at(-1) ?? [];
    expect(path).toBe('presets/evening');
    expect(value?.persona).toEqual(
      expect.objectContaining({ name: 'Evening Alex' }),
    );
    expect(revision).toBe('missing');
    await waitFor(() => expect(onSelectPreset).toHaveBeenCalledWith('evening'));
  });

  /**
   * The write expects its destination to be missing, so the engine reports a
   * taken name as a revision conflict. That is accurate about the write and
   * says nothing the operator can act on, so the surface names it instead.
   */
  it('says the name is taken rather than repeating the revision conflict', async () => {
    const user = userEvent.setup();
    const save = vi.fn<SavePreset>(() =>
      Promise.reject(new RequestError('Authored source changed on disk', 409)),
    );
    const onSelectPreset = vi.fn();
    renderSheet(onSelectPreset, save);

    await user.click(
      await screen.findByRole('button', { name: 'Preset actions' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Clone preset' }));
    await user.type(await screen.findByLabelText('Preset name'), 'evening');
    await user.click(screen.getByRole('button', { name: 'Clone' }));

    expect(
      await screen.findByText('A preset named evening already exists.'),
    ).toBeInTheDocument();
    // The existing preset is untouched and the operator keeps their name.
    expect(screen.getByLabelText('Preset name')).toHaveValue('evening');
    expect(onSelectPreset).not.toHaveBeenCalled();
  });

  it('turns a friendly name into the authored preset slug', async () => {
    const user = userEvent.setup();
    const save = vi.fn<SavePreset>(() => Promise.resolve('evening'));
    renderSheet(vi.fn(), save);

    await user.click(
      await screen.findByRole('button', { name: 'Preset actions' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Clone preset' }));
    await user.type(
      await screen.findByLabelText('Preset name'),
      'Evening Mood',
    );
    await user.click(screen.getByRole('button', { name: 'Clone' }));

    expect(save).toHaveBeenCalledWith(
      'presets/evening-mood',
      expect.anything(),
      'missing',
    );
  });

  it('reports a provider that could not report its models', async () => {
    getProviderModels.mockResolvedValue({ models: [], error: 'Key rejected' });
    renderSheet();

    expect(await screen.findByText(/Key rejected/)).toBeInTheDocument();
  });

  it('disables voice controls when speech is not configured', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <PresetSheet
          slug="default"
          onSelectPreset={vi.fn()}
          save={vi.fn(() => Promise.resolve('preset-2'))}
          ttsConfigured={false}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText('Voice')).toBeDisabled();
    expect(screen.getByLabelText('Speech speed')).toBeDisabled();
    expect(screen.getByText('Set up Speech first.')).toBeVisible();
  });
});

it('saves rapid inline edits together, preserves failure, and blocks changes during the write', async () => {
  const user = userEvent.setup();
  const pending = Promise.withResolvers<string>();
  const save = vi
    .fn<SavePreset>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue('preset-2');
  renderSheet(vi.fn(), save);
  fireEvent.change(await screen.findByLabelText('Main reasoning effort'), {
    target: { value: 'high' },
  });
  fireEvent.change(screen.getByLabelText('Summary reasoning effort'), {
    target: { value: 'medium' },
  });
  fireEvent.change(screen.getByLabelText('Speech speed'), {
    target: { value: '1.25' },
  });
  await user.click(screen.getByLabelText('Use main model for summaries'));
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'Draft persona');
  await user.tab();
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus();
  expect(screen.getByLabelText('Name').closest('fieldset')).toHaveAttribute(
    'inert',
  );
  await act(async () => pending.reject(new Error('Disk unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('Disk unavailable');
  expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('high');
  expect(screen.getByLabelText('Name')).toHaveValue('Draft persona');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenLastCalledWith(
    'presets/default',
    expect.objectContaining({
      mainEffort: 'high',
      summaryEffort: 'medium',
      useMainModelForSummary: false,
      persona: { name: 'Draft persona', description: '' },
      tts: { voice: 'af_alloy', speed: 1.25 },
    }),
    'preset-1',
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
  );
});

it('keeps an unsupported saved effort visible instead of silently showing off', async () => {
  getPresetDocument.mockResolvedValue({
    value: { ...BASE_PRESET, mainEffort: 'high' },
    revision: 'preset-1',
  });
  getProviderModels.mockResolvedValue({
    models: [
      {
        id: 'a/b',
        name: 'Model B',
        reasoning: true,
        reasoningLevels: ['off', 'low'],
        images: false,
        contextWindow: 200_000,
      },
    ],
    error: null,
  });
  const save = vi.fn<SavePreset>().mockResolvedValue('preset-2');
  renderSheet(vi.fn(), save);
  await waitFor(() =>
    expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('high'),
  );
  expect(
    within(screen.getByLabelText('Main reasoning effort')).getByRole('option', {
      name: 'high',
    }),
  ).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('searches configured providers together and saves the exact provider/model pair despite another catalog failing', async () => {
  getSettings.mockResolvedValue({
    value: { providers: { openrouter: {}, direct: {}, offline: {} } },
  });
  getProviderModels.mockImplementation((provider: string) =>
    provider === 'offline'
      ? Promise.reject(new Error('Unavailable'))
      : Promise.resolve({
          models: [
            {
              id: 'same-model',
              name: 'Same model',
              reasoning: false,
              reasoningLevels: ['off'],
              images: false,
              contextWindow: 100_000,
            },
          ],
          error: null,
        }),
  );
  const user = userEvent.setup();
  const save = vi.fn<SavePreset>().mockResolvedValue('next');
  renderSheet(vi.fn(), save);
  await screen.findByText(/offline: Unavailable/);
  await user.click(screen.getByRole('button', { name: 'Main model' }));
  await user.type(screen.getByRole('searchbox'), 'direct same-model');
  await user.click(
    screen.getByRole('button', { name: /Same model direct · same-model/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenLastCalledWith(
    'presets/default',
    expect.objectContaining({
      mainModel: { provider: 'direct', model: 'same-model' },
    }),
    'preset-1',
  );
});

it('requires an explicit provider choice for a custom model ID', async () => {
  getSettings.mockResolvedValue({
    value: { providers: { openrouter: {}, direct: {} } },
  });
  const user = userEvent.setup();
  const save = vi.fn<SavePreset>().mockResolvedValue('next');
  renderSheet(vi.fn(), save);
  await user.click(await screen.findByRole('button', { name: 'Main model' }));
  await user.type(screen.getByRole('searchbox'), 'unlisted/model');
  await user.click(
    screen.getByRole('button', { name: /Use “unlisted\/model” direct/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenLastCalledWith(
    'presets/default',
    expect.objectContaining({
      mainModel: { provider: 'direct', model: 'unlisted/model' },
    }),
    'preset-1',
  );
});

it('reports a saved clone separately from a failed conversation assignment', async () => {
  const user = userEvent.setup();
  const save = vi.fn<SavePreset>().mockResolvedValue('created');
  const select = vi.fn().mockRejectedValue(new Error('Offline'));
  renderSheet(select, save);
  await user.click(
    await screen.findByRole('button', { name: 'Preset actions' }),
  );
  await user.click(screen.getByRole('menuitem', { name: 'Clone preset' }));
  await user.type(screen.getByLabelText('Preset name'), 'New preset');
  await user.click(screen.getByRole('button', { name: 'Clone' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Created new-preset, but could not select it: Offline',
  );
  expect(
    screen.queryByRole('dialog', { name: 'Clone preset' }),
  ).not.toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Preset' })).toHaveTextContent(
    'default',
  );
});

it('waits for model discovery before changing models or summary reuse, then resets effort to the reported minimum', async () => {
  let resolveCatalog!: (value: unknown) => void;
  getProviderModels.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
  );
  getPresetDocument.mockResolvedValue({
    value: {
      ...BASE_PRESET,
      useMainModelForSummary: false,
      summaryModel: { provider: 'openrouter', model: 'a/c' },
      mainEffort: 'high',
      summaryEffort: 'high',
    },
    revision: 'preset-1',
  });
  const user = userEvent.setup();
  const save = vi.fn<SavePreset>().mockResolvedValue('next');
  renderSheet(vi.fn(), save);
  const reuse = await screen.findByLabelText('Use main model for summaries');
  await waitFor(() => expect(getProviderModels).toHaveBeenCalled());
  expect(reuse).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Main model' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Summary model' })).toBeDisabled();
  await user.click(reuse);
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue('high');
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    resolveCatalog({
      models: [
        {
          id: 'a/b',
          name: 'Model B',
          reasoning: true,
          reasoningLevels: ['low', 'high'],
          images: false,
          contextWindow: 100_000,
        },
      ],
      error: null,
    });
  });
  await waitFor(() => expect(reuse).toBeEnabled());
  await user.click(reuse);
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue('low');
  expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('high');
  expect(save).not.toHaveBeenCalled();
});

it('resets Main and reused Summary effort to the lowest supported level only in the draft, and Discard restores both', async () => {
  getPresetDocument.mockResolvedValue({
    value: { ...BASE_PRESET, mainEffort: 'high', summaryEffort: 'medium' },
    revision: 'preset-1',
  });
  getProviderModels.mockResolvedValue({
    models: [
      {
        id: 'a/b',
        name: 'Model B',
        reasoning: true,
        reasoningLevels: ['off', 'high'],
        images: false,
        contextWindow: 100_000,
      },
      {
        id: 'a/c',
        name: 'Model C',
        reasoning: true,
        reasoningLevels: ['high', 'low', 'medium'],
        images: false,
        contextWindow: 100_000,
      },
    ],
    error: null,
  });
  const user = userEvent.setup();
  const save = vi.fn<SavePreset>().mockResolvedValue('next');
  renderSheet(vi.fn(), save);
  await user.click(await screen.findByRole('button', { name: 'Main model' }));
  await user.click(screen.getByRole('button', { name: /Model C openrouter/ }));
  expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('low');
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue('low');
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('high');
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue(
    'medium',
  );
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

it('resets separate Summary effort on model changes and reuse, remembers its model, and leaves Main effort alone', async () => {
  getPresetDocument.mockResolvedValue({
    value: {
      ...BASE_PRESET,
      useMainModelForSummary: false,
      summaryModel: { provider: 'openrouter', model: 'a/c' },
      mainEffort: 'high',
      summaryEffort: 'high',
    },
    revision: 'preset-1',
  });
  getProviderModels.mockResolvedValue({
    models: [
      {
        id: 'a/b',
        name: 'Model B',
        reasoning: true,
        reasoningLevels: ['minimal', 'high'],
        images: false,
        contextWindow: 100_000,
      },
      {
        id: 'a/c',
        name: 'Model C',
        reasoning: true,
        reasoningLevels: ['low', 'high'],
        images: false,
        contextWindow: 100_000,
      },
    ],
    error: null,
  });
  const user = userEvent.setup();
  const save = vi.fn<SavePreset>().mockResolvedValue('next');
  renderSheet(vi.fn(), save);
  await user.click(
    await screen.findByRole('button', { name: 'Summary model' }),
  );
  await user.click(screen.getByRole('button', { name: /Model B openrouter/ }));
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue(
    'minimal',
  );
  expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('high');
  await user.click(screen.getByRole('button', { name: 'Summary model' }));
  await user.click(screen.getByRole('button', { name: /Model C openrouter/ }));
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue('low');
  await user.click(screen.getByLabelText('Use main model for summaries'));
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue(
    'minimal',
  );
  await user.click(screen.getByLabelText('Use main model for summaries'));
  expect(
    screen.getByRole('button', { name: 'Summary model' }),
  ).toHaveTextContent('Model C');
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue('low');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenCalledWith(
    'presets/default',
    expect.objectContaining({
      mainEffort: 'high',
      summaryEffort: 'low',
      useMainModelForSummary: false,
      summaryModel: { provider: 'openrouter', model: 'a/c' },
    }),
    'preset-1',
  );
});

it('preserves effort when reselecting the same model and uses off for unlisted custom IDs', async () => {
  getPresetDocument.mockResolvedValue({
    value: { ...BASE_PRESET, mainEffort: 'high', summaryEffort: 'medium' },
    revision: 'preset-1',
  });
  const user = userEvent.setup();
  const save = vi.fn<SavePreset>().mockResolvedValue('next');
  renderSheet(vi.fn(), save);
  await user.click(await screen.findByRole('button', { name: 'Main model' }));
  await user.click(screen.getByRole('button', { name: /Model B openrouter/ }));
  expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('high');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Main model' }));
  await user.type(screen.getByRole('searchbox'), 'unlisted/model');
  await user.click(
    screen.getByRole('button', { name: /Use “unlisted\/model” openrouter/ }),
  );
  expect(screen.getByLabelText('Main reasoning effort')).toHaveValue('off');
  expect(screen.getByLabelText('Summary reasoning effort')).toHaveValue('off');
  expect(save).not.toHaveBeenCalled();
});
