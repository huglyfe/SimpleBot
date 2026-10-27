import { useQuery } from '@tanstack/react-query';
import { getPresetList } from '../../api.js';
import { Field } from '../primitives/Field.js';
import { SearchPicker } from '../primitives/SearchPicker.js';

/** Presets share one searchable selection surface, including missing selections. */
export function PresetSelect({
  id,
  label,
  hideLabel = false,
  disabled = false,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (slug: string) => void | Promise<void>;
}) {
  const presets = useQuery({ queryKey: ['presets'], queryFn: getPresetList });
  return (
    <Field
      label={label}
      htmlFor={id}
      hideLabel={hideLabel}
      error={presets.isError ? 'Preset list unavailable.' : ''}
    >
      <SearchPicker
        id={id}
        label={label}
        disabled={disabled}
        value={value}
        fallbackLabel={value}
        emptyMessage={
          presets.isPending ? 'Loading presets…' : 'No presets available.'
        }
        options={(presets.data ?? []).map((preset) => ({
          value: preset.slug,
          label: preset.name ?? preset.slug,
          detail: preset.slug,
        }))}
        onChange={onChange}
      />
    </Field>
  );
}
