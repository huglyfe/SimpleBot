import { FocusedEditor } from './FocusedEditor.js';
import { Field } from '../primitives/Field.js';
import { FileButton } from '../primitives/FileButton.js';
import { IconButton } from '../primitives/IconButton.js';
import { CloseIcon } from '../../icons.js';

/** Name and card selection share one draft, submission, and failure boundary. */
export function NewBotPanel({
  onAddBot,
  onClose,
  returnFocus,
}: {
  onAddBot: (name: string, file?: File) => Promise<void>;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  return (
    <FocusedEditor<{ name: string; file: File | null }>
      title="New bot"
      actionLabel="Create bot"
      value={{ name: '', file: null }}
      valid={({ name, file }) => file !== null || name.trim().length > 0}
      onSave={({ name, file }) => onAddBot(name.trim(), file ?? undefined)}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {(draft, change) => (
        <div className="new-bot-fields">
          <Field label="Name" htmlFor="new-bot-name">
            <input
              id="new-bot-name"
              aria-label="Bot name"
              value={draft.name}
              placeholder={
                draft.file === null ? 'Bot name' : 'Uses card name if blank'
              }
              maxLength={255}
              onChange={(event) =>
                change({ ...draft, name: event.target.value })
              }
            />
          </Field>
          <div className="bot-file-action">
            <FileButton
              label="Import card"
              accept="image/png,application/json,.png,.json"
              onSelect={(file) => change({ ...draft, file })}
            />
            <span className="ui-hint">PNG or JSON</span>
          </div>
          {draft.file !== null ? (
            <div className="bot-file-action">
              <span className="ui-hint">{draft.file.name}</span>
              <IconButton
                label="Clear card"
                danger
                onClick={() => change({ ...draft, file: null })}
              >
                <CloseIcon />
              </IconButton>
            </div>
          ) : null}
        </div>
      )}
    </FocusedEditor>
  );
}
