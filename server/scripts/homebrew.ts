/** Prepare the formula for the exact tarball that will be published to npm. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '../..');
const tarball = process.argv[2];
if (!tarball)
  throw new Error(
    'Usage: pnpm package:brew /path/to/huglyfe-simplebot-VERSION.tgz',
  );
const manifest = JSON.parse(
  execFileSync('tar', ['-xOf', resolve(tarball), 'package/package.json'], {
    encoding: 'utf8',
  }),
) as { name: string; version: string };
if (
  manifest.name !== '@huglyfe/simplebot' ||
  !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(manifest.version)
)
  throw new Error('Expected a versioned @huglyfe/simplebot tarball');
const path = resolve(repo, 'packaging/homebrew/simplebot.rb');
const hash = createHash('sha256')
  .update(await readFile(resolve(tarball)))
  .digest('hex');
const formula = (await readFile(path, 'utf8'))
  .replace(
    /^ {2}url .*$/mu,
    `  url "https://registry.npmjs.org/@huglyfe/simplebot/-/simplebot-${manifest.version}.tgz"`,
  )
  .replace(/^ {2}sha256 .*$/mu, `  sha256 "${hash}"`)
  .replace(/^ {2}version .*$/mu, `  version "${manifest.version}"`);
await writeFile(path, formula);
console.log(`Prepared ${manifest.version}: ${hash}`);
