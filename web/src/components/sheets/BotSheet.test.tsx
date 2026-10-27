import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { Sheet } from '../primitives/Sheet.js';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../api.js';
import { BotSheet } from './BotSheet.js';

const { getBotDocument, getCapabilities, getPresetList, replaceBotArtwork } =
  vi.hoisted(() => ({
    getBotDocument: vi.fn(),
    getCapabilities: vi.fn(),
    getPresetList: vi.fn(),
    replaceBotArtwork: vi.fn(),
  }));

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  getBotDocument,
  getCapabilities,
  getPresetList,
  replaceBotArtwork,
}));

type SaveDocument = (
  path: string,
  value: Record<string, unknown>,
  revision: string,
) => Promise<string>;

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderSheet(
  save: SaveDocument = vi.fn<SaveDocument>(() => Promise.resolve('saved-2')),
  client = queryClient(),
  onClose = vi.fn(),
) {
  const view = render(
    <QueryClientProvider client={client}>
      <Sheet title="Bot" label="Bot settings" onClose={onClose}>
        <BotSheet
          slug="seraphina"
          artworkUrl="/api/bots/seraphina/avatar"
          save={save}
        />
      </Sheet>
    </QueryClientProvider>,
  );
  return { save, client, onClose, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  getPresetList.mockResolvedValue([
    { slug: 'default', model: 'model-a' },
    { slug: 'alternate', model: 'model-b' },
  ]);
  getCapabilities.mockResolvedValue({
    dependencies: [
      { kind: 'mcp', name: 'weather', available: true, error: null },
    ],
    capabilities: [
      {
        kind: 'tool',
        name: 'mcp__weather__read',
        description: 'Read weather',
        available: true,
      },
      {
        kind: 'skill',
        name: 'journaling',
        description: 'Journal carefully',
        available: true,
      },
      {
        kind: 'memory',
        dependency: 'lorebook',
        retains: false,
        available: true,
      },
    ],
  });
  getBotDocument.mockImplementation((_path: string) =>
    Promise.resolve(
      mergeDocuments(
        {
          value: { data: { name: 'Seraphina', first_mes: 'Hello.' } },
          revision: 'card-1',
        },
        {
          value: { defaultPreset: 'default', capabilities: [] },
          revision: 'config-1',
        },
      ),
    ),
  );
});

describe('BotSheet', () => {
  it('shows the bot artwork from bootstrap', async () => {
    const { container } = renderSheet();

    await screen.findByLabelText('Name');
    const artwork = container.querySelector('img');
    expect(artwork).toHaveAttribute('src', '/api/bots/seraphina/avatar');
  });

  it('saves artwork independently, preserves text drafts on failure, and allows the same file to be chosen again', async () => {
    const user = userEvent.setup();
    const { save, client } = renderSheet();
    client.setQueryData(['bootstrap'], {
      bots: [{ slug: 'seraphina', avatarUrl: '/old.png' }],
    });
    replaceBotArtwork
      .mockRejectedValueOnce(new Error('Invalid PNG'))
      .mockResolvedValueOnce('/api/bots/seraphina/avatar?v=new');
    await user.type(await screen.findByLabelText('Name'), ' edited');
    const input = screen.getByLabelText('Change image');
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    await user.upload(input, file);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid PNG');
    expect(screen.getByLabelText('Name')).toHaveValue('Seraphina edited');
    expect(client.getQueryData(['bootstrap'])).toEqual({
      bots: [{ slug: 'seraphina', avatarUrl: '/old.png' }],
    });
    await user.upload(input, file);
    await waitFor(() =>
      expect(client.getQueryData(['bootstrap'])).toEqual({
        bots: [
          { slug: 'seraphina', avatarUrl: '/api/bots/seraphina/avatar?v=new' },
        ],
      }),
    );
    expect(replaceBotArtwork).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Seraphina');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    expect(client.getQueryData(['bootstrap'])).toEqual({
      bots: [
        { slug: 'seraphina', avatarUrl: '/api/bots/seraphina/avatar?v=new' },
      ],
    });
  });

  it('blocks panel dismissal and further edits while an image upload is pending', async () => {
    const user = userEvent.setup();
    let finish: (url: string) => void = () => undefined;
    replaceBotArtwork.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { onClose } = renderSheet();
    const input = await screen.findByLabelText('Change image');
    await user.upload(
      input,
      new File(['png'], 'image.png', { type: 'image/png' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Uploading image…');
    expect(input.closest('fieldset')).toHaveAttribute('inert');
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onClose).not.toHaveBeenCalled();
    finish('/api/bots/seraphina/avatar?v=new');
    await waitFor(() =>
      expect(input.closest('fieldset')).not.toHaveAttribute('inert'),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saves immediately.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('opens the bot artwork in a larger viewer', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(
      await screen.findByRole('button', {
        name: 'View Seraphina artwork',
      }),
    );

    const viewer = screen.getByRole('dialog', { name: 'Seraphina artwork' });
    expect(
      within(viewer).getByRole('img', { name: 'Seraphina artwork' }),
    ).toHaveAttribute('src', '/api/bots/seraphina/avatar');

    await user.click(
      within(viewer).getByRole('button', { name: 'Close panel' }),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Seraphina artwork' }),
    ).not.toBeInTheDocument();
  });

  it('orders defaults and capabilities before writing and greetings', async () => {
    renderSheet();

    await screen.findByLabelText('Name');
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Capabilities', 'Writing', 'Greetings']);
  });

  it('edits one bot-writing field at a time without losing the draft', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(
      await screen.findByRole('button', { name: 'Edit Description' }),
    );
    const description = screen.getByRole('textbox', { name: 'Description' });
    await user.type(description, 'A patient traveler.');
    expect(
      screen.queryByRole('textbox', { name: 'Personality' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Edit Personality' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Personality' }),
      'Curious.',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Edit Description' }));
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'A patient traveler.',
    );
  });

  it('saves cleared bot overrides and keeps note depth', async () => {
    const user = userEvent.setup();
    const { save } = renderSheet();
    for (const label of ['System prompt', 'Post-history instructions']) {
      const opener = await screen.findByRole('button', {
        name: `Edit ${label}`,
      });
      expect(opener).toHaveTextContent('Uses preset');
      await user.click(opener);
      await user.type(screen.getByRole('textbox', { name: label }), 'Override');
      await user.click(screen.getByRole('button', { name: 'Done' }));
      await user.click(opener);
      await user.clear(screen.getByRole('textbox', { name: label }));
      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(opener).toHaveTextContent('Uses preset');
    }
    await user.click(screen.getByRole('button', { name: 'Edit Bot note' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Bot note' }),
      'Remember',
    );
    await user.clear(screen.getByLabelText('Depth'));
    await user.type(screen.getByLabelText('Depth'), '2');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Edit Bot note' }));
    await user.clear(screen.getByRole('textbox', { name: 'Bot note' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bots/seraphina',
        savedCard({
          data: {
            name: 'Seraphina',
            first_mes: 'Hello.',
            system_prompt: '',
            post_history_instructions: '',
            extensions: { depth_prompt: { prompt: '', depth: 2 } },
          },
        }),
        'card-1',
      ),
    );
  });

  it('edits the bot-owned note and depth', async () => {
    const user = userEvent.setup();
    const { save } = renderSheet();

    await user.click(
      await screen.findByRole('button', { name: 'Edit Bot note' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Bot note' }),
      'Remember the lantern.',
    );
    const depth = screen.getByLabelText('Depth');
    expect(depth).toHaveValue(4);
    await user.clear(depth);
    await user.type(depth, '2');
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bots/seraphina',
        savedCard({
          data: {
            name: 'Seraphina',
            first_mes: 'Hello.',
            extensions: {
              depth_prompt: {
                prompt: 'Remember the lantern.',
                depth: 2,
              },
            },
          },
        }),
        'card-1',
      ),
    );
  });

  it('saves the bot default explicitly even when selecting the usual default preset', async () => {
    const user = userEvent.setup();
    const save = vi.fn<SaveDocument>().mockResolvedValue('saved-2');
    renderSheet(save);
    await user.click(await screen.findByLabelText('Default preset'));
    await user.click(screen.getByRole('button', { name: /alternate/ }));
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('Default preset'));
    await user.click(screen.getByRole('button', { name: /default/ }));
    await user.type(screen.getByLabelText('Name'), ' edited');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(
      'bots/seraphina',
      savedSettings({ defaultPreset: 'default', capabilities: [] }),
      'card-1',
    );
  });

  it('keeps the selected preset visible when the list is unavailable', async () => {
    getPresetList.mockRejectedValue(new Error('Offline'));
    renderSheet();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Preset list unavailable.',
    );
    expect(screen.getByLabelText('Default preset')).toHaveTextContent(
      'default',
    );
    await userEvent.click(screen.getByLabelText('Default preset'));
    expect(
      screen.getByRole('button', { name: /default.*Saved selection/ }),
    ).toBeInTheDocument();
  });

  it('saves greeting edits and confirms removal', async () => {
    const user = userEvent.setup();
    const { save } = renderSheet();
    await user.click(
      await screen.findByRole('button', { name: 'Add greeting' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Add greeting' }),
      'Welcome back.',
    );
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      screen.getByRole('button', { name: 'Edit Greeting 2' }),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bots/seraphina',
        savedCard({
          data: {
            name: 'Seraphina',
            first_mes: 'Hello.',
            alternate_greetings: ['Welcome back.'],
          },
        }),
        'card-1',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Remove greeting 2' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      screen.queryByRole('button', { name: 'Edit Greeting 2' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit Greeting 1' }),
    ).toBeInTheDocument();
  });

  it('edits the bot capability list in the bot sheet', async () => {
    const user = userEvent.setup();
    const { save } = renderSheet();

    expect(
      await screen.findByRole('button', { name: /^weather/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('checkbox', { name: /mcp__weather__read/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^weather/ }));
    const tool = await screen.findByRole('checkbox', {
      name: /mcp__weather__read/,
    });
    expect(tool).not.toBeChecked();
    await user.click(tool);
    expect(screen.getByRole('button', { name: /^weather/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /^weather/ })).toHaveTextContent(
      '1 of 1 selected',
    );

    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bots/seraphina',
        savedSettings({
          defaultPreset: 'default',
          capabilities: [{ kind: 'tool', name: 'mcp__weather__read' }],
        }),
        'card-1',
      ),
    );
  });

  it('groups tools by source and keeps empty Skills visible without changing grants', async () => {
    getCapabilities.mockResolvedValue({
      dependencies: [
        { kind: 'mcp', name: 'weather', available: true, error: null },
        { kind: 'memory', name: 'archive', available: true, error: null },
      ],
      capabilities: [
        {
          kind: 'tool',
          name: 'mcp__weather__read',
          description: 'Read weather',
          available: true,
        },
        {
          kind: 'tool',
          name: 'system__calculator',
          description: 'Calculate',
          available: true,
        },
        {
          kind: 'tool',
          name: 'mcp__archive__search_notes',
          description: 'Search notes',
          available: true,
        },
      ],
    });
    const user = userEvent.setup();
    const { save, container } = renderSheet();
    expect(
      await screen.findByRole('button', { name: /^Skills/ }),
    ).toHaveTextContent('0 of 0 selected');
    expect(
      Array.from(
        container.querySelectorAll('.capability-toggle strong'),
        (node) => node.textContent,
      ),
    ).toEqual(['System', 'archive', 'weather', 'Skills']);
    expect(
      screen.queryByRole('button', { name: /^Tools/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Skills/ }));
    expect(screen.getByText('No skills available.')).toBeVisible();
    for (const group of ['System', 'archive', 'weather']) {
      await user.click(
        screen.getByRole('button', { name: new RegExp(`^${group}`) }),
      );
    }
    await user.click(
      screen.getByRole('checkbox', { name: /system__calculator/ }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: /mcp__archive__search_notes/ }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: /mcp__weather__read/ }),
    );
    await user.click(
      screen.getByRole('checkbox', { name: /mcp__weather__read/ }),
    );
    expect(screen.getByRole('button', { name: /^weather/ })).toHaveTextContent(
      '0 of 1 selected',
    );
    expect(screen.getByRole('button', { name: /^System/ })).toHaveTextContent(
      '1 of 1 selected',
    );
    expect(screen.getByRole('button', { name: /^archive/ })).toHaveTextContent(
      '1 of 1 selected',
    );
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bots/seraphina',
        savedSettings({
          defaultPreset: 'default',
          capabilities: [
            { kind: 'tool', name: 'system__calculator' },
            { kind: 'tool', name: 'mcp__archive__search_notes' },
          ],
        }),
        'card-1',
      ),
    );
  });

  it('edits Memory through the dedicated bot field', async () => {
    const user = userEvent.setup();
    const { save } = renderSheet();

    expect(
      screen.queryByText('One external Memory server for this bot.'),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Memory server' }),
      'lorebook',
    );

    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bots/seraphina',
        savedSettings({
          defaultPreset: 'default',
          capabilities: [{ kind: 'memory', dependency: 'lorebook' }],
        }),
        'card-1',
      ),
    );
  });

  it('keeps a selected Memory server visible when it leaves the catalog', async () => {
    getBotDocument.mockImplementation((_path: string) =>
      Promise.resolve(
        mergeDocuments(
          {
            value: { data: { name: 'Seraphina', first_mes: 'Hello.' } },
            revision: 'card-1',
          },
          {
            value: {
              defaultPreset: 'default',
              capabilities: [{ kind: 'memory', dependency: 'retired-server' }],
            },
            revision: 'config-1',
          },
        ),
      ),
    );
    renderSheet();

    const selector = await screen.findByRole('combobox', {
      name: 'Memory server',
    });
    expect(selector).toHaveValue('retired-server');
    expect(
      screen.getByRole('option', {
        name: /retired-server.*No longer configured/,
      }),
    ).toBeInTheDocument();
  });

  it('explains why selected MCP tools are unavailable without deleting them', async () => {
    getCapabilities.mockResolvedValue({
      dependencies: [
        { kind: 'mcp', name: 'offline', available: false, error: 'closed' },
        { kind: 'mcp', name: 'changed', available: true, error: null },
      ],
      capabilities: [],
    });
    getBotDocument.mockImplementation((_path: string) =>
      Promise.resolve(
        mergeDocuments(
          {
            value: { data: { name: 'Seraphina', first_mes: 'Hello.' } },
            revision: 'card-1',
          },
          {
            value: {
              defaultPreset: 'default',
              capabilities: [
                { kind: 'tool', name: 'mcp__removed__weather' },
                { kind: 'tool', name: 'mcp__offline__weather' },
                { kind: 'tool', name: 'mcp__changed__retired' },
              ],
            },
            revision: 'config-1',
          },
        ),
      ),
    );
    renderSheet();

    expect(
      await screen.findByText('MCP server removed is no longer configured.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('MCP server offline is unavailable.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('MCP server changed no longer advertises this tool.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(3);
  });

  it('writes only the changed authored document', async () => {
    const user = userEvent.setup();
    const { save } = renderSheet();

    await user.type(await screen.findByLabelText('Name'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(
      'bots/seraphina',
      expect.anything(),
      'card-1',
    );
  });

  it('reloads the unified bot document after a conflict', async () => {
    const user = userEvent.setup();
    let latest = false;
    getBotDocument.mockImplementation((_path: string) =>
      Promise.resolve(
        mergeDocuments(
          {
            value: {
              data: {
                name: latest ? 'Latest Seraphina' : 'Seraphina',
                first_mes: 'Hello.',
              },
            },
            revision: latest ? 'card-2' : 'card-1',
          },
          {
            value: {
              defaultPreset: latest ? 'latest' : 'default',
              capabilities: [],
            },
            revision: latest ? 'config-2' : 'config-1',
          },
        ),
      ),
    );
    const save = vi.fn<SaveDocument>(() =>
      Promise.reject(new RequestError('Card changed on disk', 409)),
    );
    renderSheet(save);
    await user.type(await screen.findByLabelText('Name'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('Card changed on disk')).not.toHaveLength(
      0,
    );

    latest = true;
    await user.click(screen.getByRole('button', { name: 'Reload latest' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Name')).toHaveValue('Latest Seraphina'),
    );
    expect(screen.getByLabelText('Default preset')).toHaveTextContent('latest');
  });

  it('retains failed text without changing another field', async () => {
    const user = userEvent.setup();
    const save = vi
      .fn<SaveDocument>()
      .mockRejectedValue(new Error('Save failed'));
    renderSheet(save);
    await user.type(await screen.findByLabelText('Name'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('Save failed')).not.toHaveLength(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Name')).toHaveValue('Seraphina!');
  });
});

function mergeDocuments(
  card: { value: { data: Record<string, unknown> }; revision: string },
  settings: { value: Record<string, unknown>; revision: string },
) {
  return {
    ...card,
    value: {
      ...card.value,
      data: {
        ...card.value.data,
        extensions: {
          ...(card.value.data.extensions ?? {}),
          simplebot: settings.value,
        },
      },
    },
  };
}
function savedCard(value: { data: Record<string, unknown> }) {
  return containing({
    data: containing({
      ...value.data,
      ...('extensions' in value.data
        ? { extensions: containing(value.data.extensions) }
        : {}),
    }),
  });
}
function savedSettings(value: Record<string, unknown>) {
  return containing({
    data: containing({
      extensions: containing({ simplebot: value }),
    }),
  });
}

function containing(value: unknown): unknown {
  return expect.objectContaining(value);
}
