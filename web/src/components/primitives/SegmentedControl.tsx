import { useId } from 'react';
import { cx } from '../../lib/cx.js';

export interface SegmentedControlOption<Value extends string = string> {
  value: Value;
  label: string;
  disabled?: boolean;
  hint?: string;
}

export interface SegmentedControlProps<Value extends string = string> {
  label: string;
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  onChange: (value: Value) => void;
}

/** Radio-group segmented selector; arrow keys rove natively within the group. */
export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<Value>) {
  const name = useId();
  return (
    <fieldset className="ui-segmented">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            'ui-segmented-option',
            option.value === value && 'is-selected',
            option.disabled && 'is-disabled',
          )}
          title={option.disabled ? option.hint : undefined}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => {
              onChange(option.value);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
