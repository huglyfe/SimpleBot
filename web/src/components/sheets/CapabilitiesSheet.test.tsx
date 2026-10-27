import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityCatalog } from '@simplebot/shared';

import { RequestError } from '../../api.js';
import { Sheet } from '../primitives/Sheet.js';
import { CapabilitiesSheet } from './CapabilitiesSheet.js';

const {
  getCapabilities,
  getDependencies,
  saveDependencies,
  refreshCapabilities,
  getSkills,
  saveAuthoredDocument,
  deleteSkill,
} = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getDependencies: vi.fn(),
  saveDependencies: vi.fn(),
  refreshCapabilities: vi.fn(),
  getSkills: vi.fn(),
  saveAuthoredDocument: vi.fn(),
  deleteSkill: vi.fn(),
}));

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  getSecrets: async () => ({ names: [], revision: 'empty' }),
  getCapabilities,
  getDependencies,
  saveDependencies,
  refreshCapabilities,
  getSkills,
  saveAuthoredDocument,
  deleteSkill,
}));

const CATALOG: CapabilityCatalog = {
  dependencies: [
    { kind: 'mcp', name: 'weather', available: true, error: null },
    { kind: 'memory', name: 'lorebook', available: true, error: null },
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
      available: false,
    },
    {
      kind: 'memory',
      dependency: 'lorebook',
      retains: false,
      available: true,
    },
  ],
};

function renderSheet() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Sheet
        title="Capabilities"
        label="Capabilities settings"
        onClose={() => undefined}
      >
        <CapabilitiesSheet />
      </Sheet>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  getCapabilities.mockResolvedValue(CATALOG);
  getDependencies.mockResolvedValue({
    value: { mcpServers: {}, memoryServers: {}, dockerContainers: {} },
    revision: 'root-1',
  });
  saveDependencies.mockResolvedValue('root-2');
  refreshCapabilities.mockResolvedValue(CATALOG);
  getSkills.mockResolvedValue([]);
});

describe('CapabilitiesSheet', () => {
  it('refreshes published capabilities without saving configuration', async () => {
    renderSheet();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Refresh capabilities' }),
    );
    await waitFor(() => expect(refreshCapabilities).toHaveBeenCalledTimes(1));
    expect(saveDependencies).not.toHaveBeenCalled();
  });
  it('retains a failed refresh and permits an explicit second attempt', async () => {
    refreshCapabilities.mockRejectedValueOnce(new Error('Offline'));
    renderSheet();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Refresh capabilities' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh capabilities' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(saveDependencies).not.toHaveBeenCalled();
  });
  it('retains dependency edits on stale write without reloading dependencies', async () => {
    saveDependencies.mockRejectedValueOnce(
      new RequestError('Configuration changed on disk', 409),
    );
    renderSheet();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add Docker container' }),
    );
    await userEvent.type(screen.getByLabelText('Name'), 'test');
    await userEvent.type(
      screen.getByLabelText('Container name or ID'),
      'sandbox',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(saveDependencies).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Configuration changed on disk',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit test' }));
    expect(screen.getByLabelText('Container name or ID')).toHaveValue(
      'sandbox',
    );
    expect(refreshCapabilities).not.toHaveBeenCalled();
  });
  it.each(['Environment', 'Headers'] as const)(
    'owns every visible %s entry until the subeditor saves',
    async (label) => {
      const user = userEvent.setup();
      getDependencies.mockResolvedValue({
        value: {
          mcpServers: {
            review:
              label === 'Environment'
                ? { type: 'stdio', command: '', args: [], env: {} }
                : { type: 'streamable-http', url: '', headers: {} },
          },
          memoryServers: {},
          dockerContainers: {},
        },
        revision: 'root-1',
      });
      renderSheet();
      await user.click(
        await screen.findByRole('button', { name: 'Edit review' }),
      );
      await user.click(
        screen.getByRole('button', {
          name: `Add ${label.toLowerCase()} entry`,
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Every entry needs a name.',
      );
      await user.type(screen.getByLabelText(`${label} name 1`), 'REVIEW_KEY');
      await user.type(
        screen.getByLabelText(`${label} value 1`),
        ' exact value ',
      );
      await user.click(
        screen.getByRole('button', {
          name: `Add ${label.toLowerCase()} entry`,
        }),
      );
      await user.type(screen.getByLabelText(`${label} name 2`), ' REVIEW_KEY ');
      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByRole('alert')).toHaveTextContent(
        'REVIEW_KEY already exists.',
      );
      await user.click(
        screen.getByRole('button', {
          name: `Remove ${label.toLowerCase()} entry 2`,
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(saveDependencies).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(saveDependencies).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole('button', { name: 'Edit review' }));
      expect(screen.getByLabelText(`${label} name 1`)).toHaveValue(
        'REVIEW_KEY',
      );
      expect(screen.getByLabelText(`${label} value 1`)).toHaveValue(
        ' exact value ',
      );
      await user.click(screen.getByRole('button', { name: 'Discard' }));
      await waitFor(() =>
        expect(saveDependencies).toHaveBeenCalledWith(
          expect.objectContaining({
            mcpServers: {
              review:
                label === 'Environment'
                  ? {
                      type: 'stdio',
                      command: '',
                      args: [],
                      env: { REVIEW_KEY: ' exact value ' },
                    }
                  : {
                      type: 'streamable-http',
                      url: '',
                      headers: { REVIEW_KEY: ' exact value ' },
                    },
            },
          }),
          'root-1',
        ),
      );
    },
  );

  it('adds a Memory server through the shared MCP editor', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(
      await screen.findByRole('button', { name: 'Add Memory server' }),
    );
    await user.type(screen.getByLabelText('Name'), 'Long Term Memory');
    await user.type(screen.getByLabelText('Command'), 'memory-server');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(saveDependencies).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saveDependencies).toHaveBeenCalledWith(
        {
          mcpServers: {},
          memoryServers: {
            'long-term-memory': {
              type: 'stdio',
              args: [],
              env: {},
              command: 'memory-server',
            },
          },
          dockerContainers: {},
        },
        'root-1',
      ),
    );
  });

  it('adds a Docker target through the same dependency draft', async () => {
    const user = userEvent.setup();
    const cache = renderSheet();
    cache.setQueryData(['settings'], { revision: 'root-1' });

    await user.click(
      await screen.findByRole('button', { name: 'Add Docker container' }),
    );
    await user.type(screen.getByLabelText('Name'), 'Tools Box');
    await user.type(
      screen.getByLabelText('Container name or ID'),
      'simplebot-tools',
    );
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(saveDependencies).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saveDependencies).toHaveBeenCalledWith(
        {
          mcpServers: {},
          memoryServers: {},
          dockerContainers: { 'tools-box': 'simplebot-tools' },
        },
        'root-1',
      ),
    );
    expect(cache.getQueryState(['settings'])?.isInvalidated).toBe(true);
  });
});

it('saves Skills independently and discards only dependency drafts', async () => {
  const user = userEvent.setup();
  saveAuthoredDocument.mockResolvedValue('skill-1');
  renderSheet();
  await user.click(
    await screen.findByRole('button', { name: 'Add Docker container' }),
  );
  await user.type(screen.getByLabelText('Name'), 'temporary');
  await user.type(screen.getByLabelText('Container name or ID'), 'sandbox');
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await user.click(screen.getByRole('button', { name: 'Create Skill' }));
  await user.type(screen.getByLabelText('Name'), 'independent');
  await user.type(screen.getByLabelText('Description'), 'Independent Skill');
  await user.type(screen.getByLabelText('Instructions'), 'Keep this saved');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(saveAuthoredDocument).toHaveBeenCalledWith(
    'skills/independent',
    {
      name: 'independent',
      description: 'Independent Skill',
      instructions: 'Keep this saved',
    },
    'missing',
  );
  expect(saveDependencies).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(
    screen.queryByRole('button', { name: 'Edit temporary' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit independent' }));
  expect(screen.getByLabelText('Instructions')).toHaveValue('Keep this saved');
  expect(refreshCapabilities).not.toHaveBeenCalled();
});

it('retains a Skill draft and its original revision through a failed save and cache refresh', async () => {
  const user = userEvent.setup();
  const skill = {
    value: {
      name: 'journal',
      description: 'Journal',
      instructions: 'Original',
    },
    revision: 'skill-1',
  };
  getSkills.mockResolvedValue([skill]);
  saveAuthoredDocument
    .mockRejectedValueOnce(new Error('Disk unavailable'))
    .mockResolvedValue('skill-3');
  const cache = renderSheet();
  await user.click(await screen.findByRole('button', { name: 'Edit journal' }));
  await user.type(screen.getByLabelText('Instructions'), ' edited');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Disk unavailable',
  );
  cache.setQueryData(['skills'], [{ ...skill, revision: 'skill-2' }]);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(saveAuthoredDocument).toHaveBeenLastCalledWith(
    'skills/journal',
    { ...skill.value, instructions: 'Original edited' },
    'skill-1',
  );
  expect(saveDependencies).not.toHaveBeenCalled();
});

it('keeps conflicted Skill edits visible until explicit discard without refetching or writing other files', async () => {
  const user = userEvent.setup();
  getSkills.mockResolvedValue([
    {
      value: {
        name: 'journal',
        description: 'Journal',
        instructions: 'Original',
      },
      revision: 'skill-1',
    },
  ]);
  saveAuthoredDocument.mockRejectedValue(
    new RequestError('Skill changed on disk', 409),
  );
  renderSheet();
  await user.click(await screen.findByRole('button', { name: 'Edit journal' }));
  await user.type(screen.getByLabelText('Instructions'), ' local');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Discard and reopen Capabilities',
  );
  expect(screen.getByLabelText('Instructions')).toHaveValue('Original local');
  expect(getSkills).toHaveBeenCalledTimes(1);
  expect(saveDependencies).not.toHaveBeenCalled();
  expect(refreshCapabilities).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.queryByLabelText('Instructions')).not.toBeInTheDocument();
});
