import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { skillValueSchema } from '@simplebot/shared';
import {
  AuthoredConflictError,
  AuthoredValidationError,
} from './authored-schemas.js';

/** The same file reader serves authoring and immutable catalog publication. */
export function readSkill(root: string, name: string) {
  const path = skillPath(root, name);
  const source = readFileSync(path, 'utf8');
  const { header, instructions } = parseSkill(source);
  const value = skillValueSchema.parse({
    name: header.get('name'),
    description: header.get('description'),
    instructions,
  });
  if (value.name !== name)
    throw new AuthoredValidationError('Skill name must match its directory');
  return { value, revision: revisionOf(source), source };
}

export function listSkills(root: string) {
  const parent = join(root, 'skills');
  if (!directory(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      try {
        return [readSkill(root, entry.name)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.value.name.localeCompare(b.value.name));
}

export function writeSkill(
  root: string,
  name: string,
  raw: unknown,
  expectedRevision: string,
): string {
  const value = skillValueSchema.parse(raw);
  if (value.name !== name)
    throw new AuthoredValidationError('Skill name cannot change');
  const path = skillPath(root, name);
  const current = sourceOrMissing(path);
  assertRevision(current, expectedRevision);
  const header =
    current === null ? parseDocument('{}') : parseSkill(current).header;
  header.set('name', value.name);
  header.set('description', value.description);
  const source = `---\n${header.toString()}---\n\n${value.instructions}`;
  mkdirSync(join(root, 'skills', name), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, source, { flag: 'wx' });
  renameSync(temporary, path);
  return revisionOf(source);
}

/** Remove only the authored entrypoint; supporting files are never deleted. */
export function deleteSkill(
  root: string,
  name: string,
  expectedRevision: string,
): void {
  const path = skillPath(root, name);
  assertRevision(sourceOrMissing(path), expectedRevision);
  unlinkSync(path);
}

function skillPath(root: string, name: string): string {
  skillValueSchema.shape.name.parse(name);
  for (const path of [join(root, 'skills'), join(root, 'skills', name)])
    directory(path);
  const path = join(root, 'skills', name, 'SKILL.md');
  try {
    if (!lstatSync(path).isFile())
      throw new AuthoredValidationError('Skill must be a regular file');
  } catch (error) {
    if (!missing(error)) throw error;
  }
  return path;
}

function directory(path: string): boolean {
  try {
    if (!lstatSync(path).isDirectory())
      throw new AuthoredValidationError(
        'Skill directories must be local directories',
      );
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

function parseSkill(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (match === null)
    throw new AuthoredValidationError('Skill needs YAML frontmatter');
  const header = parseDocument(match[1] ?? '');
  if (header.errors.length)
    throw new AuthoredValidationError('Invalid Skill frontmatter');
  return {
    header,
    instructions: source.slice(match[0].length).replace(/^\r?\n/u, ''),
  };
}
function sourceOrMissing(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
function assertRevision(source: string | null, expected: string): void {
  if ((source === null ? 'missing' : revisionOf(source)) !== expected)
    throw new AuthoredConflictError('Skill changed on disk');
}
function revisionOf(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}
function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
