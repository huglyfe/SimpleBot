import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  hideLabel?: boolean;
  /** Explains the setting; sits under the label. */
  description?: string;
  /** Qualifies what you entered; sits under the control. */
  hint?: string;
  error?: string;
  /** When set, the label is a real <label htmlFor>; otherwise a plain span. */
  htmlFor?: string;
  children?: ReactNode;
}

/** Shared label/control row; writing and narrow panels use a stacked layout. */
export function Field({
  label,
  hideLabel = false,
  description,
  hint,
  error,
  htmlFor,
  children,
}: FieldProps) {
  return (
    <div className="ui-field">
      <div className={hideLabel ? 'sr-only' : 'ui-field-label'}>
        {htmlFor ? (
          <label className="ui-field-title" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="ui-field-title">{label}</span>
        )}
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {children === undefined ? null : (
        <div className="ui-field-control">{children}</div>
      )}
      {error ? (
        <span className="ui-hint is-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="ui-hint">{hint}</span>
      ) : null}
    </div>
  );
}
