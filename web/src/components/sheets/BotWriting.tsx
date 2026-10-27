import type { ReactElement } from 'react';
import type { BotSource } from '@simplebot/shared';
import { Field } from '../primitives/Field.js';
import { RecordEditor, TextRecord } from './RecordEditor.js';
import { Section } from './Section.js';

const CARD_FIELDS = [
  { value: 'system_prompt', label: 'System prompt' },
  { value: 'description', label: 'Description' },
  { value: 'personality', label: 'Personality' },
  { value: 'mes_example', label: 'Example dialogue' },
  { value: 'scenario', label: 'Scenario' },
  { value: 'depth_prompt', label: 'Bot note' },
  {
    value: 'post_history_instructions',
    label: 'Post-history instructions',
  },
] as const;

export function BotWriting({
  cardData,
  patchCard,
}: {
  cardData: BotSource['data'];
  patchCard: (patch: Partial<BotSource['data']>) => void;
}): ReactElement {
  const depthPrompt = cardData.extensions?.depth_prompt;
  return (
    <Section title="Writing">
      <ul className="record-list">
        {CARD_FIELDS.map((field) =>
          field.value === 'depth_prompt' ? (
            <RecordEditor
              actionLabel="Done"
              key={field.value}
              title={field.label}
              value={{
                prompt: depthPrompt?.prompt ?? '',
                depth: depthPrompt?.depth ?? 4,
              }}
              summary={(depthPrompt?.prompt ?? '') || 'Not set'}
              onSave={(next) =>
                patchCard({
                  extensions: {
                    ...cardData.extensions,
                    depth_prompt: { ...depthPrompt, ...next },
                  },
                })
              }
            >
              {(draft, change) => (
                <>
                  <textarea
                    aria-label={field.label}
                    value={draft.prompt}
                    onChange={(event) =>
                      change({ ...draft, prompt: event.target.value })
                    }
                  />
                  <Field label="Depth" htmlFor="card-depth-prompt-depth">
                    <input
                      id="card-depth-prompt-depth"
                      type="number"
                      min="0"
                      value={draft.depth}
                      onChange={(event) =>
                        change({
                          ...draft,
                          depth: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                </>
              )}
            </RecordEditor>
          ) : (
            <TextRecord
              actionLabel="Done"
              key={field.value}
              title={field.label}
              value={cardData[field.value] ?? ''}
              emptySummary={
                field.value === 'system_prompt' ||
                field.value === 'post_history_instructions'
                  ? 'Uses preset'
                  : 'Not set'
              }
              onSave={(value) => patchCard({ [field.value]: value })}
            />
          ),
        )}
      </ul>
    </Section>
  );
}

export function BotGreetings({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}): ReactElement {
  return (
    <ul className="record-list">
      {values.map((value, index) => (
        <TextRecord
          actionLabel="Done"
          key={index}
          title={`Greeting ${String(index + 1)}`}
          value={value}
          onSave={(next) =>
            onChange(
              values.map((item, position) =>
                position === index ? next : item,
              ),
            )
          }
          remove={{
            description: 'This entry will be removed when you save the panel.',
            label: `Remove greeting ${String(index + 1)}`,
            onClick: () =>
              onChange(values.filter((_, position) => position !== index)),
          }}
        />
      ))}
      <TextRecord
        actionLabel="Done"
        title="Add greeting"
        add
        value=""
        onSave={(value) => onChange([...values, value])}
      />
    </ul>
  );
}
