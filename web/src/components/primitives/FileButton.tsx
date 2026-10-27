import { useRef } from 'react';

/** The native picker stays behind one labeled, keyboard-accessible action. */
export function FileButton({
  label,
  accept,
  onSelect,
}: {
  label: string;
  accept: string;
  onSelect: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="ui-button"
        onClick={() => input.current?.click()}
      >
        {label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) onSelect(file);
        }}
      />
    </>
  );
}
