/**
 * One search box over the engine limits, plus whatever the operator has
 * already changed. Nothing is hidden from editing; it is hidden from the
 * default screen, which is the part that was costing attention.
 */

import { useId, useMemo, useState, type ReactElement } from 'react';

import { filterFuzzy } from '../../lib/fuzzy.js';
import { Field } from '../primitives/Field.js';
import { Section } from './Section.js';

export interface AdvancedSetting {
  key: string;
  label: string;
  description: string;
  fallback: number;
  unit?: string;
  min?: number;
  keywords?: readonly string[];
}

export function AdvancedSettings({
  title,
  description,
  settings,
  values,
  onChange,
}: {
  title: string;
  description: string;
  settings: readonly AdvancedSetting[];
  values: Record<string, unknown>;
  onChange: (key: string, next: number | undefined) => void;
}): ReactElement {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const customized = useMemo(
    () =>
      settings.filter(
        (setting) =>
          typeof values[setting.key] === 'number' &&
          values[setting.key] !== setting.fallback,
      ),
    [settings, values],
  );
  const matches = useMemo(
    () =>
      filterFuzzy(settings, query, (setting) =>
        [
          setting.label,
          setting.key,
          ...(setting.keywords ?? []),
          setting.description,
        ].join(' '),
      ),
    [settings, query],
  );
  const searching = query.trim().length > 0;
  const shown = searching ? matches : customized;

  return (
    <Section title={title} description={description}>
      <Field label="Find a setting" htmlFor={searchId}>
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          placeholder="timeout, tool calls, image…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </Field>

      {shown.length === 0 ? (
        <p className="ui-hint">
          {searching
            ? `No setting matches “${query.trim()}”.`
            : 'Using defaults.'}
        </p>
      ) : (
        shown.map((setting) => {
          const configured = values[setting.key];
          const value =
            typeof configured === 'number' ? configured : setting.fallback;
          const custom = value !== setting.fallback;
          return (
            <Field
              key={setting.key}
              label={setting.label}
              description={setting.description}
              htmlFor={`advanced-${setting.key}`}
            >
              <input
                id={`advanced-${setting.key}`}
                type="number"
                min={setting.min ?? 1}
                value={Number.isNaN(value) ? '' : value}
                required
                aria-describedby={`advanced-${setting.key}-default`}
                onChange={(event) =>
                  onChange(setting.key, event.target.valueAsNumber)
                }
              />
              <span
                id={`advanced-${setting.key}-default`}
                className="settings-default"
              >
                {custom ? (
                  <button
                    type="button"
                    className="settings-reset"
                    onClick={() => {
                      onChange(setting.key, setting.fallback);
                    }}
                  >
                    Reset to {setting.fallback}
                    {setting.unit ?? ''}
                  </button>
                ) : (
                  `Default${setting.unit === undefined ? '' : ` (${setting.unit})`}`
                )}
              </span>
            </Field>
          );
        })
      )}
    </Section>
  );
}
