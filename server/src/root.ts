import { execFile } from 'node:child_process';
import { constants, existsSync, readFileSync } from 'node:fs';
import { access, cp, mkdir, chmod, lstat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ENV, PRODUCT_NAME, PRODUCT_SLUG } from '@simplebot/shared';

const run = promisify(execFile);

/** Immutable package or checkout files. Never an operator-owned root. */
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Seed files shipped beside the built server in every distribution. */
export const DEFAULTS = fileURLToPath(new URL('../defaults', import.meta.url));

/** The one schema file every distribution starts a fresh root from. */
export const SCHEMA = fileURLToPath(new URL('../schema.sql', import.meta.url));

/** The built WebUI this server serves. */
export const WEB = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * The distribution's own version. `server/dist` sits two levels under the
 * package root in the source checkout and in the published artifact alike, so
 * one specifier serves both and nothing has to inject a build constant.
 */
export const VERSION = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

/**
 * One rule for every distribution: an explicit root from the environment wins,
 * a complete existing root under the working directory keeps older roots
 * working, and anything else uses the OS location for operator-owned data. A
 * generic project `config.json` is not enough. Package files are never the
 * root.
 */
export function resolveRoot(
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  packageRoot: string = PACKAGE_ROOT,
): string {
  const explicit = environment[ENV.root];
  if (explicit !== undefined && explicit.length > 0) return resolve(explicit);
  if (
    resolve(cwd) !== resolve(packageRoot) &&
    existsSync(join(cwd, 'config.json')) &&
    existsSync(join(cwd, 'bots')) &&
    existsSync(join(cwd, 'presets'))
  )
    return resolve(cwd);
  return defaultRoot(environment);
}

/** The OS-appropriate operator data location for a packaged installation. */
export function defaultRoot(
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  system: string = platform(),
): string {
  if (system === 'darwin')
    return join(home, 'Library', 'Application Support', PRODUCT_NAME);
  if (system === 'win32')
    return join(
      environment.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
      PRODUCT_NAME,
    );
  const share = environment.XDG_DATA_HOME;
  return join(
    share !== undefined && share.length > 0
      ? share
      : join(home, '.local', 'share'),
    PRODUCT_SLUG,
  );
}

export interface InitializeResult {
  root: string;
  created: string[];
  findings: string[];
}

/** The enclosing directory protects every database, authored file, and copy. */
export async function assertPrivateRoot(root: string): Promise<void> {
  const entry = await lstat(root);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error(
      `Operator root must be a directory, not a symlink: ${root}`,
    );
  if (process.platform === 'win32') return; // Windows access uses ACLs.
  if (entry.uid !== process.getuid?.())
    throw new Error(`Operator root must belong to the current user: ${root}`);
  if ((entry.mode & 0o077) !== 0)
    throw new Error(
      `Operator root is accessible to other users: ${root}. Set its permissions to 0700 before starting SimpleBot.`,
    );
}

/**
 * Seed missing authored collections once. Existing directories own their
 * contents, including renamed cards and deliberately removed defaults.
 */
export async function initializeRoot(
  root: string,
  options: { defaults?: string; tls?: boolean } = {},
): Promise<InitializeResult> {
  const defaults = options.defaults ?? DEFAULTS;
  const created: string[] = [];
  const findings: string[] = [];
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertPrivateRoot(root);
  await mkdir(join(root, 'data', 'tls'), { recursive: true, mode: 0o700 });
  for (const [from, to] of [
    [join(defaults, 'config.example.json'), join(root, 'config.json')],
    [join(defaults, 'presets'), join(root, 'presets')],
  ] as const) {
    if (await exists(to)) continue;
    await mkdir(join(to, '..'), { recursive: true });
    await cp(from, to, { recursive: true });
    created.push(to);
  }
  const bots = join(root, 'bots');
  if (!(await exists(bots))) {
    await mkdir(bots);
    created.push(bots);
  }
  if (options.tls === false) return { root, created, findings };
  const key = join(root, 'data', 'tls', 'key.pem');
  const certificate = join(root, 'data', 'tls', 'cert.pem');
  if ((await exists(key)) && (await exists(certificate)))
    return { root, created, findings };
  try {
    await run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '3650',
      '-subj',
      `/CN=${PRODUCT_NAME}`,
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
      '-keyout',
      key,
      '-out',
      certificate,
    ]);
    await chmod(key, 0o600);
    created.push(key, certificate);
  } catch {
    // A missing certificate is reported, never worked around: packaging must
    // not weaken transport to avoid a self-signed warning.
    findings.push(
      `Could not generate a TLS certificate. Install openssl, or set ${ENV.tlsKey} and ${ENV.tlsCert}, or set "loginEnabled": false for a loopback-only install.`,
    );
  }
  return { root, created, findings };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
