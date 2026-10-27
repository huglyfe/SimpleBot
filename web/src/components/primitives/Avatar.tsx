import type { CSSProperties } from 'react';

import { botHue } from '../../lib/botHue.js';

export interface AvatarProps {
  name: string;
  artworkUrl: string | null;
  size?: number;
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

/** Circular artwork crop; deterministic pastel-gradient initials when no artwork. */
export function Avatar({ name, artworkUrl, size = 40 }: AvatarProps) {
  const style: CSSProperties = { width: size, height: size };
  if (artworkUrl) {
    // image fills the circle
  } else {
    const hue = botHue(name);
    style.background = `linear-gradient(135deg, hsl(${String(hue)} 72% 74%), hsl(${String((hue + 42) % 360)} 72% 62%))`;
    style.color = `hsl(${String(hue)} 55% 24%)`;
    style.fontSize = Math.max(10, Math.round(size * 0.38));
  }
  return (
    <span className="ui-avatar" style={style}>
      {artworkUrl ? <img src={artworkUrl} alt="" /> : initialsOf(name)}
    </span>
  );
}
