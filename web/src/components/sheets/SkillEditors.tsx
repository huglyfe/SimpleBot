import { useQueryClient } from '@tanstack/react-query';
import {
  getSkills,
  saveAuthoredDocument,
  deleteSkill,
  isAuthoredConflict,
} from '../../api.js';
import { Field } from '../primitives/Field.js';
import { RecordEditor } from './RecordEditor.js';
import { Section } from './Section.js';

type Skill = Awaited<ReturnType<typeof getSkills>>[number]['value'];

export function SkillEditors({
  skills,
}: {
  skills: Awaited<ReturnType<typeof getSkills>>;
}) {
  const cache = useQueryClient();
  async function save(value: Skill, expectedRevision: string) {
    let revision: string;
    try {
      revision = await saveAuthoredDocument(
        `skills/${encodeURIComponent(value.name)}`,
        value,
        expectedRevision,
      );
    } catch (error) {
      if (!isAuthoredConflict(error)) throw error;
      await cache.invalidateQueries({
        queryKey: ['skills'],
        refetchType: 'none',
      });
      throw new Error(
        'Skill changed on disk. Discard and reopen Capabilities to load the latest version.',
        { cause: error },
      );
    }
    cache.setQueryData(
      ['skills'],
      [
        ...skills.filter((skill) => skill.value.name !== value.name),
        { value, revision },
      ].sort((a, b) => a.value.name.localeCompare(b.value.name)),
    );
  }
  return (
    <Section title="Skills">
      <ul className="record-list">
        {skills.map((skill) => (
          <RecordEditor
            key={skill.value.name}
            title={skill.value.name}
            summary={skill.value.description}
            value={skill}
            onSave={(next) => save(next.value, next.revision)}
            remove={{
              label: `Delete Skill ${skill.value.name}`,
              description: 'Deletes SKILL.md. Supporting files are kept.',
              onClick: async () => {
                cache.setQueryData(
                  ['skills'],
                  await deleteSkill(skill.value.name, skill.revision),
                );
              },
            }}
          >
            {(draft, change) => (
              <SkillFields
                value={draft.value}
                onChange={(value) => change({ ...draft, value })}
              />
            )}
          </RecordEditor>
        ))}
        <RecordEditor
          title="Create Skill"
          add
          value={{ name: '', description: '', instructions: '' }}
          onSave={(next) => save(next, 'missing')}
        >
          {(draft, change) => (
            <SkillFields value={draft} onChange={change} creating />
          )}
        </RecordEditor>
      </ul>
    </Section>
  );
}
function SkillFields({
  value,
  onChange,
  creating = false,
}: {
  value: Skill;
  onChange: (value: Skill) => void;
  creating?: boolean;
}) {
  return (
    <>
      {creating ? (
        <Field label="Name" htmlFor="skill-name">
          <input
            id="skill-name"
            value={value.name}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={64}
            required
            onChange={(event) =>
              onChange({ ...value, name: event.target.value })
            }
          />
        </Field>
      ) : null}
      <Field label="Description" htmlFor="skill-description">
        <textarea
          className="skill-description"
          rows={3}
          id="skill-description"
          value={value.description}
          required
          maxLength={1024}
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
        />
      </Field>
      <Field label="Instructions" htmlFor="skill-instructions">
        <textarea
          id="skill-instructions"
          value={value.instructions}
          onChange={(event) =>
            onChange({ ...value, instructions: event.target.value })
          }
        />
      </Field>
    </>
  );
}
