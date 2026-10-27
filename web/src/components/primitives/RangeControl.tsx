import type { CSSProperties, InputHTMLAttributes, ReactElement } from 'react';

type RangeStyle = CSSProperties & { '--ui-range-progress': string };

export function rangeProgress(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export interface RangeControlProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'min' | 'max'
> {
  value: number;
  min: number;
  max: number;
}

export function RangeControl({
  value,
  min,
  max,
  ...props
}: RangeControlProps): ReactElement {
  const style: RangeStyle = {
    '--ui-range-progress': `${String(rangeProgress(value, min, max))}%`,
  };
  return (
    <input
      {...props}
      className={`ui-range ${props.className ?? ''}`.trim()}
      type="range"
      min={min}
      max={max}
      value={value}
      style={style}
    />
  );
}
