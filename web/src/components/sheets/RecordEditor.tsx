import { useRef, useState, type ReactNode } from 'react';
import { TrashIcon } from '../../icons.js';
import { DeleteConfirmDialog } from '../primitives/DeleteConfirmDialog.js';
import { FocusedEditor } from './FocusedEditor.js';

/** A row opens one local draft. Only its explicit action reaches the owner. */
export function RecordEditor<T>({
  title,
  summary,
  detail,
  value,
  onSave,
  children,
  add = false,
  actionLabel = 'Save',
  remove,
  editLabel = `Edit ${title}`,
}: {
  title: string;
  summary?: ReactNode;
  detail?: ReactNode;
  value: T;
  onSave: (draft: T) => void | Promise<void>;
  children: (draft: T, change: (next: T) => void) => ReactNode;
  add?: boolean;
  actionLabel?: string;
  remove?:
    | {
        description?: string;
        label: string;
        onClick: () => void | Promise<void>;
      }
    | undefined;
  editLabel?: string;
}) {
  const [action, setAction] = useState<'edit' | 'delete' | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const collection = useRef<HTMLElement | null>(null);
  return (
    <li
      ref={(element) => {
        if (element) collection.current = element.closest('ul');
      }}
      className={`record-row${add ? ' is-action' : ''}${remove ? ' is-removable' : ''}`}
    >
      <button
        ref={opener}
        type="button"
        className={`ui-button is-quiet ${add ? 'record-add' : 'record-select'}`}
        aria-label={add ? title : editLabel}
        onClick={() => {
          collection.current = opener.current?.closest('ul') ?? null;
          setAction('edit');
        }}
      >
        {add ? <span aria-hidden="true">+</span> : null}
        <strong>{title}</strong>
        {summary === undefined ? null : (
          <span className="record-preview">{summary}</span>
        )}
        {detail === undefined ? null : (
          <small className="record-detail">{detail}</small>
        )}
      </button>
      {remove === undefined ? null : (
        <button
          type="button"
          className="ui-icon-button is-danger record-remove"
          aria-label={remove.label}
          title={remove.label}
          onClick={() => setAction('delete')}
        >
          <TrashIcon />
        </button>
      )}
      {action === 'delete' && remove ? (
        <DeleteConfirmDialog
          title={remove.label + '?'}
          body={remove.description ?? 'This cannot be undone.'}
          returnFocus={() =>
            opener.current ??
            collection.current?.querySelector<HTMLElement>('button')
          }
          onClose={() => setAction(null)}
          onDelete={async () => {
            await remove.onClick();
          }}
        />
      ) : null}
      {action === 'edit' ? (
        <FocusedEditor
          title={add ? title : editLabel}
          value={value}
          onSave={onSave}
          actionLabel={actionLabel}
          onClose={() => setAction(null)}
          returnFocus={() =>
            opener.current ??
            collection.current?.querySelector<HTMLElement>('button')
          }
        >
          {children}
        </FocusedEditor>
      ) : null}
    </li>
  );
}

export function TextRecord({
  value,
  add = false,
  emptySummary = 'Not set',
  textLabel,
  ...props
}: Omit<Parameters<typeof RecordEditor<string>>[0], 'children' | 'summary'> & {
  emptySummary?: string;
  textLabel?: string;
}) {
  return (
    <RecordEditor
      {...props}
      value={value}
      summary={add ? undefined : value || emptySummary}
      add={add}
    >
      {(draft, change) => (
        <textarea
          aria-label={textLabel ?? props.title}
          value={draft}
          onChange={(event) => change(event.target.value)}
        />
      )}
    </RecordEditor>
  );
}
