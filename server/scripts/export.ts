/** Copy only the reviewed manifest; never carry Git history or operator state. */
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { publicContent } from './public-content.js';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(repo, 'dist-public');
const paths = (
  await readFile(resolve(repo, 'packaging/public-files.txt'), 'utf8')
)
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('#'));
if (new Set(paths).size !== paths.length)
  throw new Error('Duplicate public-export path');
// These maintained source trees must ship in full. Keep additions explicit in
// the allowlist; never silently include a new file in a public artifact.
const included = new Set(paths);
for (const directory of [
  'acceptance',
  'server/src',
  'server/scripts',
  'server/defaults',
  'shared/src',
  'shared/test',
  'web/src',
  'web/public',
  'web/pwa',
]) {
  for (const entry of await readdir(resolve(repo, directory), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) continue;
    const path = relative(repo, resolve(entry.parentPath, entry.name))
      .split(sep)
      .join('/');
    if (!included.has(path))
      throw new Error(`Source missing from public export: ${path}`);
  }
}
// Validate the whole manifest before replacing the disposable export.
for (const path of paths) {
  if (
    path.startsWith('/') ||
    path.split('/').some((part) => part === '..' || part === '.git')
  )
    throw new Error(`Invalid export path: ${path}`);
  if (!(await lstat(resolve(repo, path))).isFile())
    throw new Error(`Export requires a regular file: ${path}`);
}
if (process.argv.includes('--check')) {
  console.log(`${String(paths.length)} public-export paths verified.`);
  process.exit(0);
}
await rm(out, { recursive: true, force: true });
const hashes: string[] = [];
for (const path of paths) {
  const target = resolve(out, path);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(repo, path), target);
  if (path.endsWith('.md') || path.endsWith('.js') || path === '.gitignore')
    await writeFile(target, publicContent(await readFile(target, 'utf8')));
  hashes.push(
    `${createHash('sha256')
      .update(await readFile(target))
      .digest('hex')}  ${path}`,
  );
}
await writeFile(resolve(out, 'SHA256SUMS'), `${hashes.join('\n')}\n`);
console.log(
  `Exported ${String(paths.length)} reviewed files to ${out}; no Git history included.`,
);
