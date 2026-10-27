/**
 * Assembles the one relocatable `simplebot` artifact from the built workspace.
 *
 * The artifact is not a second runtime: it is the same `server/dist`, the same
 * `web/dist`, the same schema, and the same seed defaults at the same relative
 * paths the source checkout uses, plus a generated manifest with no workspace
 * protocol in it. `@simplebot/shared` is bundled so one published version
 * carries everything the CLI needs.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { publicContent } from './public-content.js';

import { PACKAGE_NAME, PRODUCT_SLUG } from '@simplebot/shared';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(repo, 'dist-package');
/**
 * The executable's path, derived so a rename cannot leave the manifest
 * pointing at a file that no longer exists: renaming the slug without
 * renaming `bin/` fails this copy loudly instead of shipping a broken `bin`.
 */
const executable = `bin/${PRODUCT_SLUG}.js`;
const root = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')) as {
  version: string;
  license: string;
  description: string;
  engines: Record<string, string>;
};
const server = JSON.parse(
  await readFile(join(repo, 'server/package.json'), 'utf8'),
) as { dependencies: Record<string, string> };

if (server.dependencies['@simplebot/shared'] === undefined)
  throw new Error('Expected @simplebot/shared to be a server dependency');
// The workspace protocol cannot survive publication, and the artifact must be
// one installable version: the built contracts ship inside it as a bundled
// dependency pinned to this same version.
const dependencies = {
  ...server.dependencies,
  '@simplebot/shared': root.version,
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

/** Declarations and source maps serve the workspace, not the installation. */
const shipped = (source: string): boolean =>
  !source.endsWith('.map') && !source.endsWith('.d.ts');

for (const [from, to] of [
  [executable, executable],
  ['server/dist', 'server/dist'],
  ['server/schema.sql', 'server/schema.sql'],
  ['server/defaults', 'server/defaults'],
  ['web/dist', 'web/dist'],
  ['shared/dist', 'node_modules/@simplebot/shared/dist'],
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['legal', 'legal'],
  ['README.md', 'README.md'],
  ['AGENTS.md', 'AGENTS.md'],
  ['CONTRIBUTING.md', 'CONTRIBUTING.md'],
  ['SECURITY.md', 'SECURITY.md'],
  ['docs/USER_GUIDE.md', 'docs/USER_GUIDE.md'],
  ['docs/ARCHITECTURE.md', 'docs/ARCHITECTURE.md'],
  ['docs/BACKEND_REQUIREMENTS.md', 'docs/BACKEND_REQUIREMENTS.md'],
  ['docs/FRONTEND_REQUIREMENTS.md', 'docs/FRONTEND_REQUIREMENTS.md'],
  ['docs/MACROS.md', 'docs/MACROS.md'],
  ['docs/images', 'docs/images'],
  ['packaging/README.md', 'packaging/README.md'],
] as const) {
  await mkdir(join(out, to, '..'), { recursive: true });
  await cp(join(repo, from), join(out, to), {
    recursive: true,
    filter: shipped,
  });
  if (to.endsWith('.md'))
    await writeFile(
      join(out, to),
      publicContent(await readFile(join(out, to), 'utf8')),
    );
}

await writeFile(
  join(out, 'node_modules/@simplebot/shared/package.json'),
  `${JSON.stringify(
    {
      name: '@simplebot/shared',
      version: root.version,
      type: 'module',
      license: root.license,
      exports: { '.': './dist/index.js' },
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: PACKAGE_NAME,
      version: root.version,
      description: root.description,
      license: root.license,
      repository: {
        type: 'git',
        url: 'https://github.com/huglyfe/simplebot.git',
      },
      homepage: 'https://github.com/huglyfe/simplebot',
      bugs: { url: 'https://github.com/huglyfe/simplebot/issues' },
      author: 'huglyfe',
      publishConfig: { access: 'public', tag: 'alpha' },
      type: 'module',
      bin: { [PRODUCT_SLUG]: executable },
      engines: { node: root.engines.node },
      files: [
        'bin',
        'server',
        'web',
        'docs',
        'legal',
        'LICENSE',
        'NOTICE',
        'README.md',
        'AGENTS.md',
        'CONTRIBUTING.md',
        'SECURITY.md',
        'packaging',
      ],
      dependencies,
      bundledDependencies: ['@simplebot/shared'],
    },
    null,
    2,
  )}\n`,
);

console.log(out);
