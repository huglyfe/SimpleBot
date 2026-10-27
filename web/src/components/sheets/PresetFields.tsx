import type { ReactElement } from 'react';
import type { Preset } from '@simplebot/shared';
import { Field } from '../primitives/Field.js';
import { SearchPicker } from '../primitives/SearchPicker.js';
import { RangeControl } from '../primitives/RangeControl.js';
import { TextRecord } from './RecordEditor.js';
import { Section } from './Section.js';

/**
 * Kokoro's shipped voices. The speech provider exposes no listing route, so
 * these are offered as suggestions over a field that still accepts any value.
 */
const VOICE_SUGGESTIONS = [
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_heart',
  'af_nova',
  'af_sky',
  'am_echo',
  'am_michael',
  'am_onyx',
  'bf_emma',
  'bm_george',
];

const CONTEXT_FIELDS = [
  ['thresholdTokens', 'Compaction threshold (tokens)'],
  ['liveTailExchanges', 'Live tail (exchanges)'],
  ['activeLeafCap', 'Active summaries'],
  ['summaryLengthChars', 'Max summary length (characters)'],
] as const;

const PROMPT_FIELDS = [
  { value: 'system', label: 'System' },
  { value: 'instructions', label: 'Instructions' },
  { value: 'postHistory', label: 'Post-history' },
  { value: 'summarization', label: 'Summary' },
] as const;

export function PresetFields({
  preset,
  patch,
  ttsConfigured,
}: {
  preset: Preset;
  patch: <K extends keyof Preset>(key: K, value: Preset[K]) => void;
  ttsConfigured: boolean;
}): ReactElement {
  const { persona, prompts, context, tts } = preset;
  return (
    <>
      <Section title="Persona">
        <Field label="Name" htmlFor="persona-name" hideLabel>
          <input
            id="persona-name"
            value={persona.name}
            onChange={(event) =>
              patch('persona', { ...persona, name: event.target.value })
            }
          />
        </Field>
        <ul className="record-list">
          <TextRecord
            actionLabel="Done"
            title="Description"
            value={persona.description}
            onSave={(description) =>
              patch('persona', { ...persona, description })
            }
          />
        </ul>
      </Section>
      <Section title="Prompts">
        <ul className="record-list">
          {PROMPT_FIELDS.map((field) => (
            <TextRecord
              actionLabel="Done"
              key={field.value}
              title={field.label}
              value={prompts[field.value]}
              onSave={(value) =>
                patch('prompts', { ...prompts, [field.value]: value })
              }
            />
          ))}
        </ul>
      </Section>

      <Section title="Context">
        {CONTEXT_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`context-${key}`}>
            <input
              id={`context-${key}`}
              type="number"
              min="1"
              value={Number.isNaN(context[key]) ? '' : context[key]}
              onChange={(event) =>
                patch('context', {
                  ...context,
                  [key]: event.target.valueAsNumber,
                })
              }
              required
            />
          </Field>
        ))}
      </Section>

      <Section
        title="Voice"
        {...(ttsConfigured ? {} : { description: 'Set up Speech first.' })}
      >
        <fieldset className="settings-group" disabled={!ttsConfigured}>
          <Field label="Voice" htmlFor="tts-voice">
            <SearchPicker
              label="Voice"
              id="tts-voice"
              value={tts.voice === '' ? null : tts.voice}
              fallbackLabel={tts.voice}
              disabled={!ttsConfigured}
              options={VOICE_SUGGESTIONS.map((voice) => ({
                value: voice,
                label: voice,
                detail:
                  voice.startsWith('af_') || voice.startsWith('bf_')
                    ? 'female'
                    : 'male',
              }))}
              onChange={(value) => {
                patch('tts', { ...tts, voice: value });
              }}
              customOptions={(query) =>
                VOICE_SUGGESTIONS.includes(query)
                  ? []
                  : [{ value: query, label: `Use ${query}` }]
              }
            />
          </Field>
          <Field label="Speed" htmlFor="tts-speed">
            <div className="settings-slider">
              <RangeControl
                id="tts-speed"
                aria-label="Speech speed"
                min={0.25}
                max={4}
                step={0.05}
                value={tts.speed}
                onChange={(event) =>
                  patch('tts', { ...tts, speed: Number(event.target.value) })
                }
              />
              <output htmlFor="tts-speed">{tts.speed.toFixed(2)}×</output>
            </div>
          </Field>
        </fieldset>
      </Section>
    </>
  );
}
