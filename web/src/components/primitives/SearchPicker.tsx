import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { CheckIcon, CloseIcon, SearchIcon } from '../../icons.js';
import { filterFuzzy } from '../../lib/fuzzy.js';
import { errorMessage } from '../../lib/errorMessage.js';
import { IconButton } from './IconButton.js';

export interface SearchOption {
  value: string;
  label: string;
  detail?: string;
}

/** One inline catalog search for presets, models, timezones, and voices. */
export function SearchPicker({
  id,
  label,
  value,
  fallbackLabel,
  options,
  disabled = false,
  emptyMessage = 'No options available.',
  customOptions,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  fallbackLabel?: string;
  options: SearchOption[];
  disabled?: boolean;
  emptyMessage?: string;
  customOptions?: (query: string) => SearchOption[];
  onChange: (value: string) => void | Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? fallbackLabel ?? value ?? 'Choose…';
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!open && !pending && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [open, pending]);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const available =
    value !== null && !selected
      ? [
          {
            value,
            label: fallbackLabel ?? value,
            detail: 'Saved selection · not in catalog',
          },
          ...options,
        ]
      : options;
  const filtered = open
    ? filterFuzzy(available, query, (option) => [
        option.label,
        option.detail ?? '',
      ])
    : [];
  // Put the saved selection first on open; searching always uses relevance order.
  const shown = query.trim()
    ? filtered
    : filtered.toSorted(
        (a, b) => Number(b.value === value) - Number(a.value === value),
      );
  const choices = [
    ...shown,
    ...(open && query.trim()
      ? (customOptions?.(query.trim()) ?? [])
      : []
    ).filter((option) => !shown.some((entry) => entry.value === option.value)),
  ];
  function close(): void {
    if (pending) return;
    setOpen(false);
    restoreFocus.current = true;
  }
  async function select(next: string) {
    if (pending) return;
    if (next === value) return close();
    setPending(true);
    setError(null);
    try {
      await onChange(next);
      setOpen(false);
      restoreFocus.current = true;
    } catch (caught) {
      setError(errorMessage(caught, 'Could not select'));
    } finally {
      setPending(false);
    }
  }
  const phone = window.matchMedia(
    '(max-width: 800px), (pointer: coarse)',
  ).matches;
  return (
    <div
      className="ui-picker-field"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        className="ui-picker-trigger"
        aria-label={label}
        title={selectedLabel}
        aria-controls={open ? `${id}-choices` : undefined}
        aria-expanded={open}
        disabled={disabled || pending}
        onClick={() => {
          setQuery('');
          setError(null);
          setOpen(!open);
        }}
      >
        <span>{selectedLabel}</span>
      </button>
      {open ? (
        <div
          id={`${id}-choices`}
          role="group"
          aria-label={`${label} choices`}
          className="ui-picker"
          onKeyDown={(event) => {
            if (pending || !['ArrowDown', 'ArrowUp'].includes(event.key))
              return;
            event.preventDefault();
            const buttons = [
              ...(results.current?.querySelectorAll<HTMLButtonElement>(
                'button',
              ) ?? []),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === 'ArrowDown'
                ? index + 1
                : index < 0
                  ? buttons.length - 1
                  : index - 1;
            (buttons[next] ?? input.current)?.focus();
          }}
        >
          <div className="ui-picker-search">
            <SearchIcon />
            <input
              ref={input}
              autoFocus={!phone}
              type="search"
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search by name or identifier…"
              value={query}
              disabled={pending}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  if (choices[0]) void select(choices[0].value);
                }
              }}
            />
            {query ? (
              <IconButton
                label="Clear search"
                disabled={pending}
                onClick={() => {
                  setQuery('');
                  input.current?.focus();
                }}
              >
                <CloseIcon />
              </IconButton>
            ) : null}
          </div>
          {error ? (
            <p className="ui-notice" role="alert">
              {error}
            </p>
          ) : null}
          <div ref={results} className="ui-picker-results" aria-busy={pending}>
            {choices.map((option) => (
              <button
                type="button"
                className="ui-button is-quiet ui-picker-option"
                key={option.value}
                aria-pressed={option.value === value}
                disabled={pending}
                onClick={() => void select(option.value)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.detail ? (
                    <>
                      {' '}
                      <small>{option.detail}</small>
                    </>
                  ) : null}
                </span>
                {option.value === value ? <CheckIcon /> : null}
              </button>
            ))}
            {choices.length === 0 || (!query.trim() && options.length === 0) ? (
              <p className="ui-empty">
                {query.trim() ? 'No matches.' : emptyMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
