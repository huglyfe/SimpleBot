import type { ReactElement } from 'react';
import {
  TODO_TITLE_MAX,
  TODO_NOTE_MAX,
  todoCreateSchema,
  formatTodoDue,
  type Todo,
  type TodoCreate,
} from '@simplebot/shared';
import { Field } from '../primitives/Field.js';
import { RecordEditor } from './RecordEditor.js';

type Draft = TodoCreate & { id?: string };

export function TodosPanel({
  todos,
  timezone,
  onSave,
  onDelete,
}: {
  todos: Todo[];
  timezone: string;
  onSave: (todo: Draft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}): ReactElement {
  function save(draft: Draft): Promise<void> {
    const { id, ...fields } = draft;
    const parsed = todoCreateSchema.safeParse(fields);
    if (!parsed.success)
      throw new Error(
        'Enter a title and a valid due date, or leave the date blank.',
      );
    return onSave({ ...parsed.data, ...(id === undefined ? {} : { id }) });
  }
  function fields(draft: Draft, change: (next: Draft) => void): ReactElement {
    return (
      <>
        <Field label="Title" htmlFor="todo-title">
          <input
            id="todo-title"
            value={draft.title}
            maxLength={TODO_TITLE_MAX}
            onChange={(event) =>
              change({ ...draft, title: event.target.value })
            }
          />
        </Field>
        <Field label="Due date" htmlFor="todo-due">
          <input
            id="todo-due"
            type="date"
            value={draft.dueDate ?? ''}
            onChange={(event) =>
              change({ ...draft, dueDate: event.target.value || null })
            }
          />
        </Field>
        <Field label="Note" htmlFor="todo-note">
          <textarea
            id="todo-note"
            value={draft.note}
            maxLength={TODO_NOTE_MAX}
            onChange={(event) => change({ ...draft, note: event.target.value })}
          />
        </Field>
      </>
    );
  }
  return (
    <ul className="record-list">
      {todos.map((todo) => (
        <RecordEditor<Draft>
          key={todo.id}
          title={todo.title}
          editLabel={`Edit to-do ${todo.title}`}
          summary={todo.note}
          detail={formatTodoDue(todo.dueDate, timezone, new Date())}
          value={todo}
          onSave={save}
          actionLabel="Save to-do"
          remove={{
            label: `Delete to-do ${todo.title}`,
            description:
              'This to-do will be removed from this conversation. No closed history is kept.',
            onClick: () => onDelete(todo.id),
          }}
        >
          {fields}
        </RecordEditor>
      ))}
      <RecordEditor<Draft>
        title="Add to-do"
        add
        value={{ title: '', dueDate: null, note: '' }}
        onSave={save}
        actionLabel="Create to-do"
      >
        {fields}
      </RecordEditor>
    </ul>
  );
}
