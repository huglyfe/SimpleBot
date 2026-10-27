import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The token layer is the single source of colour and shape. Area stylesheets
 * compose tokens and reference declared values.
 */

const stylesDir = import.meta.dirname;

function areaStylesheets(): { name: string; source: string }[] {
  return readdirSync(stylesDir)
    .filter((name) => name.endsWith('.css') && name !== 'tokens.css')
    .map((name) => ({
      name,
      source: readFileSync(join(stylesDir, name), 'utf8'),
    }));
}

/** Declaration values only — property names and selectors never carry colour. */
function declarationValues(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => /^[^:]+:\s*(.+?);?\s*$/.exec(line.trim())?.[1])
    .filter((value): value is string => value !== undefined);
}

describe('token discipline', () => {
  it('declares no raw colour outside tokens.css', () => {
    for (const { name, source } of areaStylesheets()) {
      const offenders = declarationValues(source).filter((value) =>
        /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(value),
      );

      expect(offenders, `${name} must use colour tokens`).toEqual([]);
    }
  });

  /**
   * `--ui-` names are per-instance properties a component sets inline (sheet
   * width, range progress). They are not design tokens and must always be
   * read with a fallback, so they are exempt from the declaration rule.
   */
  it('names every token it references', () => {
    const tokens = new Set(
      [
        ...readFileSync(join(stylesDir, 'tokens.css'), 'utf8').matchAll(
          /^\s{2}(--[a-z0-9-]+):/gm,
        ),
      ].map((match) => match[1] ?? ''),
    );

    for (const { name, source } of areaStylesheets()) {
      const referenced = [...source.matchAll(/var\((--[a-z0-9-]+)/g)].map(
        (match) => match[1] ?? '',
      );
      const unknown = [...new Set(referenced)].filter(
        (token) => !tokens.has(token) && !token.startsWith('--ui-'),
      );

      expect(unknown, `${name} references undefined tokens`).toEqual([]);
    }
  });
});
