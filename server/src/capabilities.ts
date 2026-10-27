import { listSkills } from './skills.js';

import {
  capabilityIdentity,
  type CapabilityCatalog,
  type BotCapability,
} from '@simplebot/shared';

import type { AppConfig, AuthoredFiles } from './authored.js';
import {
  activateDocker,
  type DockerLimits,
  type DockerResources,
} from './docker.js';
import { activateMcp, type ExternalTool, type McpResources } from './mcp.js';
import { SYSTEM_TOOL_DEFINITIONS } from './assemble-tools.js';

export interface SkillSnapshot {
  name: string;
  description: string;
  source: string;
}

interface MemoryStatus {
  name: string;
  available: boolean;
  error: string | null;
  retains: boolean;
}

export interface SelectedCapabilities {
  toolNames: string[];
  externalTools: ExternalTool[];
  skills: SkillSnapshot[];
  memory: Extract<
    CapabilityCatalog['capabilities'][number],
    { kind: 'memory' }
  > | null;
  terminal: string | null;
}

/** One immutable catalog and the live resources that supplied it. */
export class ActivatedCapabilities {
  readonly catalog: CapabilityCatalog;
  readonly #skills: ReadonlyMap<string, SkillSnapshot>;
  readonly #mcp: McpResources;
  readonly #docker: DockerResources;

  constructor(
    catalog: CapabilityCatalog,
    skills: readonly SkillSnapshot[],
    mcp: McpResources,
    docker: DockerResources,
  ) {
    this.catalog = catalog;
    this.#skills = new Map(skills.map((skill) => [skill.name, skill]));
    this.#mcp = mcp;
    this.#docker = docker;
  }

  select(desired: readonly BotCapability[]): SelectedCapabilities {
    const selected: SelectedCapabilities = {
      toolNames: [],
      externalTools: [],
      skills: [],
      memory: null,
      terminal: null,
    };
    for (const capability of desired) {
      const entry = this.catalog.capabilities.find(
        (entry) =>
          entry.available &&
          capabilityIdentity(entry) === capabilityIdentity(capability),
      );
      if (entry === undefined) continue;
      switch (entry.kind) {
        case 'tool': {
          if (
            entry.name.startsWith('system__') ||
            entry.name.startsWith('docker__')
          )
            selected.toolNames.push(entry.name);
          else {
            const tool = this.#mcp.tools.find(
              (tool) => tool.name === entry.name,
            );
            if (tool !== undefined) selected.externalTools.push(tool);
          }
          break;
        }
        case 'skill': {
          const skill = this.#skills.get(entry.name);
          if (skill !== undefined) selected.skills.push(skill);
          break;
        }
        case 'memory':
          selected.memory = entry;
          break;
        case 'terminal':
          selected.terminal = entry.dependency;
          break;
      }
    }
    if (selected.externalTools.length > 0)
      selected.toolNames.push('system__tool_search', 'system__tool_call');
    if (selected.skills.length > 0)
      selected.toolNames.push('system__skill_read');
    if (selected.terminal !== null) selected.toolNames.push('system__terminal');
    return selected;
  }

  call(
    name: string,
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    return this.#mcp.call(name, arguments_, signal);
  }

  runTerminal(
    name: string,
    command: string,
    limits: DockerLimits,
    signal: AbortSignal,
  ): Promise<string> {
    return this.#docker.run(name, command, limits, signal);
  }

  fileTools() {
    return this.#docker.fileTools();
  }

  callFile(
    name: string,
    args: Record<string, unknown>,
    limits: DockerLimits,
    signal: AbortSignal,
  ) {
    return this.#docker.callFile(name, args, limits, signal);
  }

  transferDockerOwnershipTo(next: ActivatedCapabilities): void {
    this.#docker.transferOwnershipTo(next.#docker);
  }

  async close(): Promise<void> {
    await Promise.all([this.#mcp.close(), this.#docker.close()]);
  }
}

export async function activateCapabilities(
  authored: AuthoredFiles,
  config: AppConfig,
): Promise<ActivatedCapabilities> {
  const memoryNames = new Set(Object.keys(config.memoryServers));
  const [skills, mcp, docker] = await Promise.all([
    Promise.resolve(
      listSkills(authored.root).map(({ value, source }) => ({
        name: value.name,
        description: value.description,
        source,
      })),
    ),
    activateMcp(
      { ...config.mcpServers, ...config.memoryServers },
      authored.root,
    ),
    activateDocker(config.dockerContainers),
  ]);
  try {
    return new ActivatedCapabilities(
      buildCatalog(skills, mcp, docker, memoryNames),
      skills,
      mcp,
      docker,
    );
  } catch (error) {
    // Connections are open and containers may be started by this point. A
    // caller that never receives the set cannot close it, so failing here
    // releases what this activation opened before it propagates.
    await Promise.all([mcp.close(), docker.close()]);
    throw error;
  }
}

function buildCatalog(
  skills: readonly SkillSnapshot[],
  mcp: McpResources,
  docker: DockerResources,
  memoryNames: ReadonlySet<string>,
): CapabilityCatalog {
  const memoryStatuses: MemoryStatus[] = mcp.statuses
    .filter((status) => memoryNames.has(status.name))
    .map((status) => {
      if (!status.available) return { ...status, retains: false };
      const protocol = memoryProtocol(status.name, mcp.tools);
      return protocol.error === null
        ? { ...status, retains: protocol.retains }
        : {
            name: status.name,
            available: false,
            error: protocol.error,
            retains: false,
          };
    });
  const memoryByName = new Map(
    memoryStatuses.map((status) => [status.name, status]),
  );
  const dependencies: CapabilityCatalog['dependencies'] = [
    ...mcp.statuses.map(
      ({
        name,
        available,
        error,
      }): CapabilityCatalog['dependencies'][number] => {
        const memory = memoryByName.get(name);
        return memory === undefined
          ? { kind: 'mcp', name, available, error }
          : {
              kind: 'memory',
              name,
              available: memory.available,
              error: memory.error,
            };
      },
    ),
    ...docker.statuses.map(({ name, available, error }) => ({
      kind: 'docker' as const,
      name,
      available,
      error,
    })),
  ];
  const memoryCapabilities: CapabilityCatalog['capabilities'] =
    memoryStatuses.map(({ name, retains, available }) => ({
      kind: 'memory',
      dependency: name,
      retains,
      available,
    }));
  const capabilities: CapabilityCatalog['capabilities'] = [
    ...SYSTEM_TOOL_DEFINITIONS.filter((tool) => tool.selectable).map(
      ({ name, description }) => ({
        kind: 'tool' as const,
        name,
        description,
        available: true,
      }),
    ),
    ...skills.map(({ name, description }) => ({
      kind: 'skill' as const,
      name,
      description,
      available: true,
    })),
    ...mcp.tools
      .filter(
        (tool) =>
          !memoryNames.has(tool.server) ||
          (tool.definition.name !== 'recall' &&
            tool.definition.name !== 'retain'),
      )
      .map((tool) => ({
        kind: 'tool' as const,
        name: tool.name,
        description: tool.definition.description ?? '',
        available: true,
      })),
    ...memoryCapabilities,
  ];
  capabilities.push(
    ...docker.fileTools().map(({ name, description, available }) => ({
      kind: 'tool' as const,
      name,
      description,
      available,
    })),
    ...docker.statuses.map(({ name, available }) => ({
      kind: 'terminal' as const,
      dependency: name,
      available,
    })),
  );
  // `activateMcp` already rejected ambiguous external names, and system
  // tools, Skills, and dependencies each own a distinct identity space. This
  // keeps that guarantee true of the published result itself.
  if (
    new Set(capabilities.map(capabilityIdentity)).size !== capabilities.length
  )
    throw new Error('Duplicate capability identity');
  return { dependencies, capabilities };
}

function memoryProtocol(
  dependency: string,
  tools: readonly ExternalTool[],
): { retains: boolean; error: string | null } {
  const byName = new Map(
    tools
      .filter((tool) => tool.server === dependency)
      .map((tool) => [tool.definition.name, tool.classification]),
  );
  if (byName.get('recall') !== 'read')
    return {
      retains: false,
      error: 'Memory servers must expose read-only recall',
    };
  const retain = byName.get('retain');
  if (retain !== undefined && retain !== 'stateful')
    return {
      retains: false,
      error: 'Memory retain must be stateful',
    };
  return { retains: retain === 'stateful', error: null };
}
