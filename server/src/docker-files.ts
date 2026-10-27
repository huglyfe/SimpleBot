import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { z } from 'zod';

export const FILE_BYTES = 1_048_576;
const pathSchema = z
  .string()
  .startsWith('/')
  .max(4096)
  .refine(
    (value) => !/[\0\r\n]/u.test(value),
    'Use an absolute container path without control characters',
  );
const filePath = Type.String({
  minLength: 1,
  maxLength: 4096,
  description: 'Absolute path inside the container.',
});
const page = Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 }));
export const FILE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a text file with line numbers.',
    parameters: Type.Object({
      path: filePath,
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: page,
    }),
  },
  {
    name: 'write_file',
    description: 'Create or replace a text file.',
    parameters: Type.Object({
      path: filePath,
      content: Type.String({ maxLength: FILE_BYTES }),
    }),
  },
  {
    name: 'edit_file',
    description: 'Replace one exact, unique match in a text file.',
    parameters: Type.Object({
      path: filePath,
      old_text: Type.String({ minLength: 1, maxLength: FILE_BYTES }),
      new_text: Type.String({ maxLength: FILE_BYTES }),
    }),
  },
  {
    name: 'search_files',
    description:
      'Find filenames (glob) or matching lines (regex) inside the container.',
    parameters: Type.Object({
      path: filePath,
      pattern: Type.String({ minLength: 1, maxLength: 1000 }),
      target: Type.Optional(
        Type.Union([Type.Literal('content'), Type.Literal('files')]),
      ),
      limit: page,
    }),
  },
] as const;

export type FileOperation = (typeof FILE_TOOLS)[number]['name'];
export type FileExec = (
  script: string,
  input?: string,
) => Promise<{ stdout: Buffer; stderr: Buffer; code: number }>;
export const quoteShell = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

// One supported GNU toolchain. No installation, alternate commands, or retries.
export const FILE_REQUIREMENTS = `set -e
for cmd in head cat mktemp mv rm chmod sha256sum rg; do
  command -v "$cmd" >/dev/null || { printf 'Missing filesystem command: %s' "$cmd"; exit 1; }
  "$cmd" --version >/dev/null
done`;

async function checked(
  run: FileExec,
  script: string,
  input?: string,
): Promise<Buffer> {
  const result = await run(script, input);
  if (result.code !== 0)
    throw new Error(
      result.stderr.toString('utf8').trim().slice(0, 500) ||
        `File operation failed (exit ${String(result.code)}).`,
    );
  return result.stdout;
}

function text(bytes: Buffer): string {
  if (bytes.length > FILE_BYTES)
    throw new Error('File exceeds the 1 MiB text limit.');
  if (bytes.includes(0)) throw new Error('File is not UTF-8 text.');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error('File is not UTF-8 text.');
  }
}

async function read(run: FileExec, path: string): Promise<Buffer> {
  return checked(
    run,
    `p=${quoteShell(path)}; [ -f "$p" ] && [ ! -L "$p" ] || { echo 'Expected a regular file, not a symlink.' >&2; exit 1; }; head -c ${String(FILE_BYTES + 1)} -- "$p"`,
  );
}

async function write(
  run: FileExec,
  path: string,
  content: string,
  expectedHash?: string,
): Promise<string> {
  text(Buffer.from(content));
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  await checked(
    run,
    `set -eu
p=${quoteShell(path)}
[ ! -L "$p" ] && { [ ! -e "$p" ] || [ -f "$p" ]; } || { echo 'Expected a regular file, not a symlink.' >&2; exit 1; }
tmp=$(mktemp -- ${quoteShell(`${parent}/.simplebot-XXXXXX`)})
trap 'rm -f -- "$tmp"' EXIT HUP INT TERM
cat > "$tmp"
${expectedHash === undefined ? '' : `actual=$(sha256sum < "$p"); [ "\${actual%% *}" = ${quoteShell(expectedHash)} ] || { echo 'Not changed: file changed during editing. Read it again.' >&2; exit 1; }`}
if [ -e "$p" ]; then chmod --reference="$p" -- "$tmp"; fi
mv -fT -- "$tmp" "$p"
trap - EXIT HUP INT TERM`,
    content,
  );
  return `Wrote ${path} (${String(Buffer.byteLength(content))} bytes).`;
}

export async function runFileTool(
  operation: FileOperation,
  args: Record<string, unknown>,
  run: FileExec,
): Promise<string> {
  const path = pathSchema.parse(args.path);
  switch (operation) {
    case 'read_file': {
      const offset = z
        .number()
        .int()
        .min(1)
        .max(Number.MAX_SAFE_INTEGER)
        .default(1)
        .parse(args.offset);
      const limit = z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(200)
        .parse(args.limit);
      const source = text(await read(run, path));
      if (source === '') return 'Empty file.';
      const lines = source.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const result = lines
        .slice(offset - 1, offset - 1 + limit)
        .map((line, index) => `${String(offset + index)}: ${line}`)
        .join('\n');
      return (
        (result || 'No lines at this offset.') +
        (offset - 1 + limit < lines.length
          ? `\n[More lines; continue at offset ${String(offset + limit)}.]`
          : '')
      );
    }
    case 'write_file':
      return write(run, path, z.string().max(FILE_BYTES).parse(args.content));
    case 'edit_file': {
      const oldText = z.string().min(1).max(FILE_BYTES).parse(args.old_text);
      const newText = z.string().max(FILE_BYTES).parse(args.new_text);
      const bytes = await read(run, path);
      const source = text(bytes);
      const index = source.indexOf(oldText);
      if (index < 0) return 'Not changed: old_text was not found.';
      if (source.includes(oldText, index + 1))
        return 'Not changed: old_text matches multiple locations. Include more surrounding text.';
      await write(
        run,
        path,
        source.slice(0, index) + newText + source.slice(index + oldText.length),
        createHash('sha256').update(bytes).digest('hex'),
      );
      return `Updated ${path} (1 replacement).`;
    }
    case 'search_files': {
      const pattern = z
        .string()
        .min(1)
        .max(1000)
        .refine((value) => !value.includes('\0'))
        .parse(args.pattern);
      const target = z
        .enum(['files', 'content'])
        .default('content')
        .parse(args.target);
      const limit = z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(50)
        .parse(args.limit);
      const command =
        target === 'files'
          ? `rg --files -g ${quoteShell(pattern)} -- ${quoteShell(path)}`
          : `rg --color never --no-heading --line-number --with-filename --max-count ${String(limit + 1)} -e ${quoteShell(pattern)} -- ${quoteShell(path)}`;
      const result = await run(command);
      if (result.code === 1 && result.stderr.length === 0) return 'No matches.';
      if (result.code !== 0)
        throw new Error(
          result.stderr.toString('utf8').trim().slice(0, 500) ||
            'Search failed.',
        );
      const lines = result.stdout
        .toString('utf8')
        .replace(/\n$/u, '')
        .split('\n');
      return (
        lines.slice(0, limit).join('\n') +
        (lines.length > limit
          ? '\n[Results truncated; narrow the search.]'
          : '')
      );
    }
  }
}
