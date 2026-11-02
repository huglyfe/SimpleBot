/** Application settings and searchable engine limits. */

import { useMemo, type ReactElement } from 'react';
import {
  APPLICATION_DEFAULTS,
  PRODUCT_NAME,
  type AppSettings,
} from '@simplebot/shared';

import { SegmentedControl } from '../primitives/SegmentedControl.js';
import { SearchPicker } from '../primitives/SearchPicker.js';
import type { Appearance } from '../../theme/theme.js';
import { AdvancedSettings, type AdvancedSetting } from './AdvancedSettings.js';
import { Field } from '../primitives/Field.js';
import { Section } from './Section.js';
import { LoginManagement } from './LoginManagement.js';

/**
 * The engine's own ceilings. Every one of these has a value that works, so the
 * screen states the default rather than demanding a number.
 */
const LIMITS = [
  {
    key: 'browserLoginExpiryDays',
    label: 'Browser login expiry (days)',
    description:
      'Days without activity before login expires; 0 disables expiry. Applies on next use.',
    min: 0,
    keywords: ['session', 'cookie', 'authentication', 'login', 'expiry'],
  },
  {
    key: 'maxMessageChars',
    label: 'Message characters',
    description: 'Longest message the composer will send.',
    keywords: ['length', 'composer', 'input'],
  },
  {
    key: 'maxModelCallsPerTurn',
    label: 'Model calls per turn',
    description: 'How many times one turn may call the model before stopping.',
    keywords: ['loop', 'iterations', 'provider'],
  },
  {
    key: 'modelCallTimeoutMs',
    label: 'Model timeout',
    description: 'Milliseconds to wait for one provider call.',
    unit: 'ms',
    keywords: ['timeout', 'provider', 'stall'],
  },
  {
    key: 'maxToolCallsPerTurn',
    label: 'Tool calls per turn',
    description: 'How many tools one turn may run.',
    keywords: ['tools', 'loop'],
  },
  {
    key: 'maxToolResultChars',
    label: 'Tool result characters',
    description: 'Longest single tool result kept in context.',
    keywords: ['tools', 'truncate', 'output'],
  },
  {
    key: 'maxToolResultCharsTotal',
    label: 'Total tool characters',
    description: 'Combined tool output one turn may add to context.',
    keywords: ['tools', 'truncate', 'budget'],
  },
  {
    key: 'maxImageDimension',
    label: 'Image dimension',
    description: 'Largest attachment edge accepted, in pixels.',
    unit: 'px',
    keywords: ['attachment', 'picture', 'upload', 'resize'],
  },
  {
    key: 'terminalTimeoutMs',
    label: 'Terminal timeout',
    description: 'Milliseconds one terminal command may run.',
    unit: 'ms',
    keywords: ['docker', 'shell', 'command', 'timeout'],
  },
  {
    key: 'terminalMaxOutputChars',
    label: 'Terminal output characters',
    description: 'Longest terminal result kept in context.',
    keywords: ['docker', 'shell', 'truncate'],
  },
] as const satisfies readonly Omit<AdvancedSetting, 'fallback'>[];

const SETTINGS = LIMITS.map((setting) => ({
  ...setting,
  fallback: APPLICATION_DEFAULTS[setting.key],
}));

export function ApplicationSheet({
  value,
  patch,
  version,
  appearance,
  onAppearanceChange,
}: {
  value: { application: Partial<AppSettings['application']> };
  patch: (key: string, next: unknown) => void;
  /** Reported by the running server, never spelled by the client. */
  version: string;
  appearance: Appearance;
  onAppearanceChange: (next: Appearance) => void;
}): ReactElement {
  const application = value.application;
  const timezoneOptions = useMemo(
    () =>
      [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].map(
        (timeZone) => ({
          value: timeZone,
          label: timeZone
            .slice(timeZone.lastIndexOf('/') + 1)
            .replaceAll('_', ' '),
          detail: timeZone,
        }),
      ),
    [],
  );

  function patchApplication(key: string, next: unknown): void {
    patch('application', { ...application, [key]: next });
  }

  return (
    <>
      <Section title="General">
        <Field label="Timezone" htmlFor="app-timezone">
          <SearchPicker
            label="Timezone"
            id="app-timezone"
            value={application.timezone ?? APPLICATION_DEFAULTS.timezone}
            fallbackLabel={
              application.timezone ?? APPLICATION_DEFAULTS.timezone
            }
            options={timezoneOptions}
            onChange={(timeZone) => {
              patchApplication('timezone', timeZone);
            }}
          />
        </Field>
        <Field label="Clock format">
          <SegmentedControl
            label="Clock format"
            value={application.clockFormat ?? APPLICATION_DEFAULTS.clockFormat}
            options={[
              { value: '12', label: '12-hour' },
              { value: '24', label: '24-hour' },
            ]}
            onChange={(next) => patchApplication('clockFormat', next)}
          />
        </Field>
        <Field label="Pairing" description="Restart required.">
          <SegmentedControl
            label="Pairing"
            value={application.loginEnabled === false ? 'off' : 'on'}
            options={[
              { value: 'on', label: 'Required' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(next) => {
              patchApplication('loginEnabled', next === 'on');
            }}
          />
        </Field>
        <Field label="Appearance">
          <SegmentedControl
            label="Appearance"
            value={appearance}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(next) => {
              onAppearanceChange(next);
            }}
          />
        </Field>
      </Section>

      <AdvancedSettings
        title="Limits"
        description="Search to change a limit. Changed values stay listed."
        settings={SETTINGS}
        values={application}
        onChange={(key, next) =>
          patch('application', { ...application, [key]: next })
        }
      />

      <LoginManagement />

      <Section title="About">
        <Field
          label={`${PRODUCT_NAME} ${version}`}
          description="Alpha software · Apache-2.0"
        >
          <a
            href="https://github.com/huglyfe/simplebot"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
          {' · '}
          <a href="/legal/LICENSE" target="_blank" rel="noreferrer">
            License
          </a>
          {' · '}
          <a
            href="/legal/THIRD-PARTY-NOTICES.txt"
            target="_blank"
            rel="noreferrer"
          >
            Third-party notices
          </a>
        </Field>
      </Section>
    </>
  );
}
