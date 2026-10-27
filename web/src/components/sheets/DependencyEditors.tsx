import { type ReactElement, type ReactNode } from 'react';
import type {
  CapabilityCatalog,
  DependencyConfigDraft,
} from '@simplebot/shared';
import { Field } from '../primitives/Field.js';
import {
  ServerFields,
  type ServerRole,
  type ServerDraft,
  type Entries,
} from './ServerFields.js';
import type { McpDefinition } from '@simplebot/shared';
import { RecordEditor } from './RecordEditor.js';
import { authoredSlug } from './slugs.js';

function serverLabel(kind: ServerRole): string {
  return kind === 'mcp' ? 'MCP server' : 'Memory server';
}
function serverDraft(value: McpDefinition): ServerDraft {
  return value.type === 'stdio'
    ? { ...value, env: Object.entries(value.env) }
    : { ...value, headers: Object.entries(value.headers) };
}

function entryMap(entries: Entries): Record<string, string> {
  const names = new Set<string>();
  return Object.fromEntries(
    entries.map(([raw, value]) => {
      const name = raw.trim();
      if (!name) throw new Error('Every entry needs a name.');
      if (names.has(name)) throw new Error(`${name} already exists.`);
      names.add(name);
      return [name, value];
    }),
  );
}

function serverDefinition(value: ServerDraft): McpDefinition {
  return value.type === 'stdio'
    ? { ...value, env: entryMap(value.env) }
    : { ...value, headers: entryMap(value.headers) };
}

function emptyServer(): ServerDraft {
  return { type: 'stdio', command: '', args: [], env: [] };
}

export function DependencyEditors({
  value,
  catalog,
  onChange,
}: {
  value: DependencyConfigDraft;
  catalog: CapabilityCatalog;
  onChange: (next: DependencyConfigDraft) => void;
}): ReactElement {
  function status(kind: 'mcp' | 'memory' | 'docker', name: string): ReactNode {
    const entry = catalog.dependencies.find(
      (item) => item.kind === kind && item.name === name,
    );
    if (entry === undefined) return 'Not loaded';
    const count = catalog.capabilities.filter(
      (item) => item.kind === 'tool' && item.name.startsWith(`mcp__${name}__`),
    ).length;
    return entry.available ? (
      <span className="dependency-available">
        Available
        {kind === 'mcp' &&
          ` · ${String(count)} ${count === 1 ? 'tool' : 'tools'}`}
      </span>
    ) : (
      <span className="ui-hint is-error">
        Unavailable{entry.error ? ` · ${entry.error}` : ''}
      </span>
    );
  }

  function update<K extends keyof DependencyConfigDraft>(
    key: K,
    name: string,
    definition: DependencyConfigDraft[K][string] | null,
  ): void {
    const entries = { ...value[key] };
    if (definition === null) delete entries[name];
    else entries[name] = definition;
    return onChange({ ...value, [key]: entries });
  }

  function newName(raw: string, key: keyof DependencyConfigDraft): string {
    const name = authoredSlug(raw);
    if (!name) throw new Error('Enter a name.');
    const inventories =
      key === 'dockerContainers'
        ? [value.dockerContainers]
        : [value.mcpServers, value.memoryServers];
    if (inventories.some((entries) => Object.hasOwn(entries, name)))
      throw new Error(`${name} already exists.`);
    return name;
  }
  return (
    <>
      {(['mcp', 'memory'] as const).map((kind) => {
        const key = kind === 'mcp' ? 'mcpServers' : 'memoryServers';
        const servers = value[key];
        return (
          <section className="settings-subsection" key={kind}>
            <h4>{serverLabel(kind)}s</h4>
            <ul className="record-list">
              {Object.entries(servers).map(([name, definition]) => (
                <RecordEditor
                  actionLabel="Done"
                  key={name}
                  title={name}
                  summary={status(kind, name)}
                  value={serverDraft(definition)}
                  onSave={(next) => update(key, name, serverDefinition(next))}
                  remove={{
                    description:
                      'This entry will be removed when you save the panel.',
                    label: `Remove ${serverLabel(kind)} ${name}`,
                    onClick: () => update(key, name, null),
                  }}
                >
                  {(draft, change) => (
                    <ServerFields
                      kind={kind}
                      name={name}
                      value={draft}
                      onChange={change}
                    />
                  )}
                </RecordEditor>
              ))}
              <RecordEditor
                actionLabel="Done"
                title={`Add ${serverLabel(kind)}`}
                add
                value={{ name: '', definition: emptyServer() }}
                onSave={(draft) => {
                  const name = newName(draft.name, key);
                  return update(key, name, serverDefinition(draft.definition));
                }}
              >
                {(draft, change) => (
                  <>
                    <Field label="Name" htmlFor="dependency-name">
                      <input
                        id="dependency-name"
                        value={draft.name}
                        onChange={(event) =>
                          change({ ...draft, name: event.target.value })
                        }
                      />
                    </Field>
                    <ServerFields
                      kind={kind}
                      name="new"
                      value={draft.definition}
                      onChange={(definition) =>
                        change({ ...draft, definition })
                      }
                    />
                  </>
                )}
              </RecordEditor>
            </ul>
          </section>
        );
      })}
      <section className="settings-subsection">
        <h4>Docker containers</h4>
        <ul className="record-list">
          {Object.entries(value.dockerContainers).map(([name, target]) => (
            <RecordEditor
              actionLabel="Done"
              key={name}
              title={name}
              summary={status('docker', name)}
              value={target}
              onSave={(next) => update('dockerContainers', name, next)}
              remove={{
                description:
                  'This entry will be removed when you save the panel.',
                label: `Remove Docker container ${name}`,
                onClick: () => update('dockerContainers', name, null),
              }}
            >
              {(draft, change) => (
                <Field label="Container name or ID" htmlFor="docker-target">
                  <input
                    id="docker-target"
                    value={draft}
                    onChange={(event) => change(event.target.value)}
                  />
                </Field>
              )}
            </RecordEditor>
          ))}
          <RecordEditor
            actionLabel="Done"
            title="Add Docker container"
            add
            value={{ name: '', target: '' }}
            onSave={(draft) => {
              const name = newName(draft.name, 'dockerContainers');
              return update('dockerContainers', name, draft.target);
            }}
          >
            {(draft, change) => (
              <>
                <Field label="Name" htmlFor="dependency-name">
                  <input
                    id="dependency-name"
                    value={draft.name}
                    onChange={(event) =>
                      change({ ...draft, name: event.target.value })
                    }
                  />
                </Field>
                <Field label="Container name or ID" htmlFor="docker-target">
                  <input
                    id="docker-target"
                    value={draft.target}
                    onChange={(event) =>
                      change({ ...draft, target: event.target.value })
                    }
                  />
                </Field>
              </>
            )}
          </RecordEditor>
        </ul>
      </section>
    </>
  );
}
