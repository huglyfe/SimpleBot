import { useState, type ReactElement } from 'react';
import {
  capabilityIdentity,
  type BotCapability,
  type CapabilityCatalog,
} from '@simplebot/shared';
import { Section } from './Section.js';

type CatalogCapability = CapabilityCatalog['capabilities'][number];
type SelectableCatalogCapability = Exclude<
  CatalogCapability,
  { kind: 'memory' }
>;

function capabilityGroups(catalog: CapabilityCatalog) {
  const tools = catalog.capabilities.filter((entry) => entry.kind === 'tool');
  const servers = catalog.dependencies.toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
  return [
    {
      key: 'system',
      label: 'System',
      entries: tools.filter((entry) => entry.name.startsWith('system__')),
    },
    ...servers.map((server) => ({
      key: `server:${server.kind}:${server.name}`,
      label: server.kind === 'docker' ? `Docker: ${server.name}` : server.name,
      entries: tools.filter((entry) =>
        entry.name.startsWith(
          `${server.kind === 'docker' ? 'docker' : 'mcp'}__${server.name}__`,
        ),
      ),
    })),
    {
      key: 'skill',
      label: 'Skills',
      entries: catalog.capabilities.filter((entry) => entry.kind === 'skill'),
    },
    {
      key: 'terminal',
      label: 'Terminals',
      entries: catalog.capabilities.filter(
        (entry) => entry.kind === 'terminal',
      ),
    },
  ].filter((group) => group.key === 'skill' || group.entries.length > 0);
}

function capabilityLabel(capability: BotCapability): string {
  return capability.kind === 'tool' || capability.kind === 'skill'
    ? capability.name
    : capability.dependency;
}

function unavailableDetail(
  capability: Exclude<BotCapability, { kind: 'memory' }>,
  catalog: CapabilityCatalog,
): string {
  if (capability.kind === 'skill') return 'Skill is no longer installed.';
  const name =
    capability.kind === 'tool'
      ? (capability.name.split('__')[1] ?? capability.name)
      : capability.dependency;
  const kind =
    capability.kind === 'terminal' || capability.name.startsWith('docker__')
      ? 'docker'
      : 'mcp';
  const label = `${kind === 'docker' ? 'Docker target' : 'MCP server'} ${name}`;
  const dependency = catalog.dependencies.find(
    (entry) =>
      entry.name === name &&
      (kind === 'docker' ? entry.kind === 'docker' : entry.kind !== 'docker'),
  );
  if (dependency === undefined) return `${label} is no longer configured.`;
  if (!dependency.available) return `${label} is unavailable.`;
  return capability.kind === 'terminal'
    ? `${label} is no longer advertised.`
    : `${label} no longer advertises this tool.`;
}

/** Capability edits remain part of the owning bot's single authored draft. */
export function BotCapabilities({
  catalog,
  error,
  value,
  onChange,
}: {
  catalog: CapabilityCatalog | null;
  error: string | null;
  value: BotCapability[];
  onChange: (value: BotCapability[]) => void;
}) {
  const known = new Set((catalog?.capabilities ?? []).map(capabilityIdentity));
  const selectedKeys = new Set(value.map(capabilityIdentity));
  const unknown = value
    .filter((capability) => capability.kind !== 'memory')
    .filter((capability) => !known.has(capabilityIdentity(capability)));

  function toggleCapability(capability: BotCapability, enabled: boolean): void {
    const target = capabilityIdentity(capability);
    const next = value.filter(
      (entry) =>
        capabilityIdentity(entry) !== target &&
        !(
          enabled &&
          capability.kind === 'terminal' &&
          entry.kind === 'terminal'
        ),
    );
    if (enabled)
      next.push(
        capability.kind === 'tool' || capability.kind === 'skill'
          ? { kind: capability.kind, name: capability.name }
          : { kind: capability.kind, dependency: capability.dependency },
      );
    onChange(next);
  }

  return (
    <Section title="Capabilities">
      {error !== null ? (
        <p className="ui-notice" role="alert">
          {error}
        </p>
      ) : catalog === null ? (
        <p className="muted">Loading capability catalog…</p>
      ) : (
        <div className="capability-groups">
          {capabilityGroups(catalog).map((group) => (
            <CapabilityGroup
              key={group.key}
              label={group.label}
              entries={group.entries}
              selectedKeys={selectedKeys}
              onToggle={toggleCapability}
            />
          ))}
        </div>
      )}
      {unknown.length === 0 ? null : (
        <div className="grant-unknown">
          <strong>Unavailable selections</strong>
          {unknown.map((capability) => (
            <CapabilityRow
              key={capabilityIdentity(capability)}
              capability={capability}
              selected
              available={false}
              description={
                catalog === null ? null : unavailableDetail(capability, catalog)
              }
              onToggle={toggleCapability}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function CapabilityGroup({
  label,
  entries,
  selectedKeys,
  onToggle,
}: {
  label: string;
  entries: SelectableCatalogCapability[];
  selectedKeys: ReadonlySet<string>;
  onToggle: (capability: BotCapability, selected: boolean) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const selected = entries.filter((capability) =>
    selectedKeys.has(capabilityIdentity(capability)),
  ).length;

  return (
    <section className="capability-group">
      <button
        type="button"
        className="capability-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <strong>{label}</strong>
        <span className="count">
          {selected} of {entries.length} selected
        </span>
      </button>
      {open ? (
        <div className="capability-list">
          {entries.length === 0 ? (
            <p className="muted">No skills available.</p>
          ) : null}
          {entries.map((capability) => (
            <CapabilityRow
              key={capabilityIdentity(capability)}
              capability={capability}
              selected={selectedKeys.has(capabilityIdentity(capability))}
              available={capability.available}
              description={
                capability.kind === 'terminal'
                  ? 'Terminal target'
                  : capability.description
              }
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CapabilityRow({
  capability,
  selected,
  available,
  description,
  onToggle,
}: {
  capability: BotCapability;
  selected: boolean;
  available: boolean;
  description: string | null;
  onToggle: (capability: BotCapability, selected: boolean) => void;
}): ReactElement {
  return (
    <label className="grant-row">
      <input
        className="ui-switch"
        type="checkbox"
        checked={selected}
        onChange={(event) => onToggle(capability, event.target.checked)}
      />
      <span>
        <code>{capabilityLabel(capability)}</code>
        {available ? null : (
          <span className="tag is-unreachable">unavailable</span>
        )}
        {description === null ? null : <small>{description}</small>}
      </span>
    </label>
  );
}
