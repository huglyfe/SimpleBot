import {
  createHash,
  createPrivateKey,
  randomUUID,
  X509Certificate,
} from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { z } from 'zod';
import { ENV } from '@simplebot/shared';

import { assertCurrentSchema } from './database.js';
import type { Storage } from './storage.js';
import { AuthoredFiles } from './authored.js';
import { assertPrivateRoot } from './root.js';

const manifestSchema = z.strictObject({
  format: z.literal('simplebot-backup'),
  createdAt: z.iso.datetime(),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
  ),
  external: z.array(z.string().min(1)),
});

type Manifest = z.infer<typeof manifestSchema>;

export async function createBackup(
  root: string,
  destination: string,
  storage: Pick<Storage, 'backup'>,
): Promise<Manifest> {
  const target = resolve(destination);
  await assertAbsent(target);
  const stage = `${target}.${randomUUID()}.partial`;
  const payload = join(stage, 'payload');
  await mkdir(join(payload, 'data'), { recursive: true, mode: 0o700 });
  try {
    for (const path of ['config.json', 'bots', 'presets', 'skills'])
      await copyIfPresent(join(root, path), join(payload, path));
    for (const path of ['attachments', 'tts', 'tls'])
      await copyIfPresent(
        join(root, 'data', path),
        join(payload, 'data', path),
      );
    await storage.backup(join(payload, 'data', 'app.db'));
    const manifest: Manifest = {
      format: 'simplebot-backup',
      createdAt: new Date().toISOString(),
      files: await describeFiles(payload),
      external: [
        'environment credentials',
        'saved secrets (re-enter after restore)',
        'custom TLS paths',
        'Docker containers',
        'provider data',
      ],
    };
    await writeFile(
      join(stage, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    await verifyBackup(stage);
    await rename(stage, target);
    return manifest;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBackup(path: string): Promise<Manifest> {
  const parsed = manifestSchema.safeParse(
    JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')),
  );
  if (!parsed.success) throw new Error('Invalid backup manifest');
  const source = parsed.data;
  const actual = await describeFiles(join(path, 'payload'));
  if (JSON.stringify(actual) !== JSON.stringify(source.files))
    throw new Error('Backup checksum verification failed');
  await assertAttachmentsPresent(join(path, 'payload'), actual);
  return source;
}

export async function restoreBackup(
  path: string,
  freshRoot: string,
): Promise<void> {
  await verifyBackup(path);
  await assertAbsent(resolve(freshRoot));
  await mkdir(dirname(resolve(freshRoot)), { recursive: true });
  await mkdir(resolve(freshRoot), { mode: 0o700 });
  // Copy children so a backup's outer directory mode cannot weaken this root.
  const payload = join(resolve(path), 'payload');
  for (const name of await readdir(payload))
    await cp(join(payload, name), join(resolve(freshRoot), name), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
}

export async function doctor(
  root: string,
  databasePath: string,
): Promise<{
  ok: boolean;
  findings: string[];
}> {
  const findings: string[] = [];
  try {
    await assertPrivateRoot(root);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  const authored = new AuthoredFiles(root);
  let loginEnabled = true;
  try {
    loginEnabled = (await authored.validateRequired()).application.loginEnabled;
  } catch (error) {
    findings.push(
      `Authored state: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // An empty collection is a healthy fresh install; creation belongs to the operator.
  try {
    const bots = await authored.listBots();
    const entries = await readdir(join(root, 'bots'), { withFileTypes: true });
    if (bots.length === 0 && entries.some((entry) => entry.isDirectory()))
      findings.push('No readable bot in bots/');
  } catch {
    findings.push('Missing or unreadable: bots/');
  }
  if (loginEnabled) {
    const keyPath = process.env[ENV.tlsKey] ?? join(root, 'data/tls/key.pem');
    const certificatePath =
      process.env[ENV.tlsCert] ?? join(root, 'data/tls/cert.pem');
    let key: ReturnType<typeof createPrivateKey> | undefined;
    try {
      key = createPrivateKey(await readFile(keyPath));
    } catch {
      findings.push(`Invalid TLS key: ${relative(root, keyPath)}`);
    }
    try {
      const certificate = new X509Certificate(await readFile(certificatePath));
      if (
        Date.now() < Date.parse(certificate.validFrom) ||
        Date.now() > Date.parse(certificate.validTo)
      )
        findings.push('TLS certificate is outside its validity period');
      if (key && !certificate.checkPrivateKey(key))
        findings.push('TLS certificate does not match the private key');
    } catch {
      findings.push(
        `Invalid TLS certificate: ${relative(root, certificatePath)}`,
      );
    }
  }
  try {
    const database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertCurrentSchema(database);
      const result = database.pragma('quick_check', { simple: true });
      if (result !== 'ok')
        findings.push(`SQLite quick_check: ${String(result)}`);
    } finally {
      database.close();
    }
  } catch (error) {
    findings.push(
      `Database: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { ok: findings.length === 0, findings };
}

/**
 * The staged files are copied before the database is snapshotted, so an
 * attachment that lands between the two is a row with no file. Making the two
 * halves atomic means quiescing the engine; catching the disagreement here
 * costs one read, and a backup that fails is one the operator runs again.
 * Files the database does not name are harmless and stay unmentioned.
 */
async function assertAttachmentsPresent(
  payload: string,
  files: Manifest['files'],
): Promise<void> {
  const path = join(payload, 'data', 'app.db');
  const database = new Database(path, { readonly: true, fileMustExist: true });
  let keys: { storage_key: string }[];
  try {
    keys = database
      .prepare(`SELECT storage_key FROM attachments`)
      .all() as typeof keys;
  } finally {
    database.close();
    // Opening a WAL database leaves its side files beside it, and they would
    // be two payload files the manifest does not describe. The snapshot is a
    // complete standalone database, so a read-only connection's empty journal
    // has nothing in it to lose.
    await Promise.all(
      ['-wal', '-shm'].map((suffix) =>
        unlink(`${path}${suffix}`).catch(() => undefined),
      ),
    );
  }
  const present = new Set(files.map((file) => file.path));
  for (const { storage_key: key } of keys) {
    if (!present.has(join('data', 'attachments', key)))
      throw new Error(`Backup is missing attachment file: ${key}`);
  }
}

async function copyIfPresent(source: string, target: string): Promise<void> {
  try {
    const entry = await lstat(source);
    if (entry.isSymbolicLink())
      throw new Error(`Backup source is a symlink: ${source}`);
    await cp(source, target, {
      recursive: entry.isDirectory(),
      errorOnExist: true,
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
}

async function describeFiles(root: string): Promise<Manifest['files']> {
  const files: Manifest['files'] = [];
  async function walk(parent: string): Promise<void> {
    for (const entry of (await readdir(parent, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const path = join(parent, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Backup payload contains a symlink: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const data = await readFile(path);
        files.push({
          path: relative(root, path),
          bytes: (await stat(path)).size,
          sha256: createHash('sha256').update(data).digest('hex'),
        });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(`Path already exists: ${path}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
}
