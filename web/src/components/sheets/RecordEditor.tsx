import { useRef, useState, type ReactNode } from 'react';
import { TrashIcon } from '../../icons.js';
import { DeleteConfirmDialog } from '../primitives/DeleteConfirmDialog.js';
import { IconButton } from '../primitives/IconButton.js';
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
  action,
  editLabel = `Edit ${title}`,
  editDisabled = false,
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
  /** One trailing row control other than removal, such as regeneration. */
  action?: ReactNode;
  editLabel?: string;
  editDisabled?: boolean;
}) {
  const [open, setOpen] = useState<'edit' | 'delete' | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const collection = useRef<HTMLElement | null>(null);
  const trailing =
    remove === undefined ? (
      action
    ) : (
      <IconButton label={remove.label} danger onClick={() => setOpen('delete')}>
        <TrashIcon />
      </IconButton>
    );
  return (
    <li
      ref={(element) => {
        if (element) collection.current = element.closest('ul');
      }}
      className={`record-row${add ? ' is-action' : ''}${trailing ? ' has-trailing' : ''}`}
    >
      <button
        ref={opener}
        type="button"
        className={`ui-button is-quiet ${add ? 'record-add' : 'record-select'}`}
        aria-label={add ? title : editLabel}
        disabled={editDisabled}
        onClick={() => {
          collection.current = opener.current?.closest('ul') ?? null;
          setOpen('edit');
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
      {trailing ? <span className="record-trailing">{trailing}</span> : null}
      {open === 'delete' && remove ? (
        <DeleteConfirmDialog
          title={remove.label + '?'}
          body={remove.description ?? 'This cannot be undone.'}
          returnFocus={() =>
            opener.current ??
            collection.current?.querySelector<HTMLElement>('button')
          }
          onClose={() => setOpen(null)}
          onDelete={async () => {
            await remove.onClick();
          }}
        />
      ) : null}
      {open === 'edit' ? (
        <FocusedEditor
          title={add ? title : editLabel}
          value={value}
          onSave={onSave}
          actionLabel={actionLabel}
          onClose={() => setOpen(null)}
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
