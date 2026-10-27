import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';

import {
  ENV,
  PRODUCT_NAME,
  PRODUCT_SLUG,
  PRODUCT_TAGLINE,
} from '@simplebot/shared';

import { AuthoredFiles } from './authored.js';
import { OwnerAuth } from './auth.js';
import {
  createBackup,
  doctor,
  restoreBackup,
  verifyBackup,
} from './operations.js';
import { initializeRoot, resolveRoot, SCHEMA, VERSION, WEB } from './root.js';
import { createRuntime } from './runtime.js';
import { initializeDatabase } from './database.js';

const USAGE = `${PRODUCT_SLUG} - ${PRODUCT_TAGLINE}

Usage: ${PRODUCT_SLUG} [command] [arguments]

  start                        Initialize an absent root and run the server (default)
  init                         Create the operator root without starting the server
  doctor                       Report authored, certificate, and database findings
  pair                         Print a one-use browser pairing code
  pair key                     Set and print a long-lived owner key
  backup <directory>           Write a verified snapshot of this root
  verify <directory>           Check a snapshot without restoring it
  restore <directory> <root>   Restore a snapshot into a fresh, absent root
  remove-data                  Delete this root's data after explicit confirmation
  version                      Print the version
  help                         Print this message

The root is ${ENV.root}, else a complete ${PRODUCT_NAME} root in the working
directory, else the OS location for operator data. ${ENV.host},
${ENV.port}, ${ENV.tlsKey}, and ${ENV.tlsCert} override the
listener and certificate.`;

export interface CliIO {
  out: (line: string) => void;
  error: (line: string) => void;
  confirm: (question: string) => Promise<string>;
}

const consoleIO: CliIO = {
  out: (line) => console.log(line),
  error: (line) => console.error(line),
  confirm: async (question) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
};

/**
 * Every distribution enters here. The scoped npm package, a Homebrew install,
 * and the source checkout run the same commands against the same root layout;
 * only the location of the package files differs.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIO = consoleIO,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    return await runCommand(argv, io, environment);
  } catch (error) {
    // The operator sees the message, not the stack. Every failure raised below
    // is written for them — a missing certificate, a root from a newer build,
    // a database that does not exist yet — and a trace would bury it.
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runCommand(
  argv: readonly string[],
  io: CliIO,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const [command = 'start', ...rest] = argv;
  const root = resolveRoot(environment);

  if (command === 'help' || command === '--help' || command === '-h') {
    io.out(USAGE);
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    io.out(VERSION);
    return 0;
  }
  if (command === 'init') {
    const result = await initializeRoot(root);
    // A root includes its database, so `init` then `pair` works.
    await initializeDatabase(databasePath(root), SCHEMA);
    io.out(`Root: ${result.root}`);
    for (const path of result.created) io.out(`Created ${path}`);
    if (result.created.length === 0) io.out('Already initialized.');
    for (const finding of result.findings) io.error(finding);
    return result.findings.length === 0 ? 0 : 1;
  }
  if (command === 'start') {
    await start(root, io, environment);
    return 0;
  }
  if (command === 'doctor') {
    const result = await doctor(root, databasePath(root));
    io.out(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (command === 'pair') {
    return withDatabase(root, (database) => {
      const auth = new OwnerAuth(database);
      if (rest[0] === 'key') {
        const key = randomBytes(24).toString('base64url');
        auth.setOwnerKey(key);
        io.out(key);
        return 0;
      }
      const issued = auth.issuePairingCode();
      io.out(`${issued.code}\nExpires: ${issued.expiresAt}`);
      return 0;
    });
  }
  if (command === 'backup') {
    const destination = rest[0];
    if (destination === undefined) return usageError(io, 'backup <directory>');
    return withDatabase(root, async (database) => {
      const manifest = await createBackup(root, destination, {
        backup: async (target) => {
          await database.backup(target);
        },
      });
      io.out(JSON.stringify(manifest, null, 2));
      return 0;
    });
  }
  if (command === 'verify') {
    const path = rest[0];
    if (path === undefined) return usageError(io, 'verify <directory>');
    io.out(JSON.stringify(await verifyBackup(path), null, 2));
    return 0;
  }
  if (command === 'restore') {
    const [path, freshRoot] = rest;
    if (path === undefined || freshRoot === undefined)
      return usageError(io, 'restore <directory> <fresh-root>');
    await restoreBackup(path, freshRoot);
    io.out(resolve(freshRoot));
    return 0;
  }
  if (command === 'remove-data') {
    // Uninstalling code never removes conversations. This is the one command
    // that does, it names the exact root, and it requires the operator to type
    // that root back.
    io.out(`This permanently deletes every conversation, bot, preset,`);
    io.out(`credential reference, attachment, and backup under:`);
    io.out(`  ${root}`);
    const answer = await io.confirm(`Type the root path to confirm: `);
    if (answer.trim() !== root) {
      io.error('Confirmation did not match. Nothing was removed.');
      return 1;
    }
    await rm(root, { recursive: true, force: true });
    io.out(`Removed ${root}`);
    return 0;
  }
  io.error(`Unknown command: ${command}\n\n${USAGE}`);
  return 2;
}

async function start(
  root: string,
  io: CliIO,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const initialized = await initializeRoot(root);
  for (const path of initialized.created) io.out(`Created ${path}`);
  // A finding here names what the certificate read below is about to fail on.
  for (const finding of initialized.findings) io.error(finding);
  const config = await new AuthoredFiles(root).validateRequired();
  const { application } = config;
  const host = environment[ENV.host] ?? '127.0.0.1';
  const loopback = host === '127.0.0.1' || host === '::1';
  if (!application.loginEnabled && !loopback)
    throw new Error(
      `Login-disabled mode requires ${ENV.host}=127.0.0.1 or ::1.`,
    );
  if (!loopback && (!environment[ENV.tlsKey] || !environment[ENV.tlsCert]))
    throw new Error(
      `Remote access requires ${ENV.tlsKey} and ${ENV.tlsCert}. Use a certificate for your server name that clients trust.`,
    );
  const tls = application.loginEnabled
    ? {
        key: await readFile(
          resolve(environment[ENV.tlsKey] ?? join(root, 'data/tls/key.pem')),
        ),
        cert: await readFile(
          resolve(environment[ENV.tlsCert] ?? join(root, 'data/tls/cert.pem')),
        ),
      }
    : undefined;
  const runtime = await createRuntime({
    config,
    paths: { root, database: databasePath(root), schema: SCHEMA, web: WEB },
    ...(tls === undefined ? {} : { tls }),
  });
  const port = Number(environment[ENV.port] ?? '3000');
  let address: string;
  try {
    address = await runtime.app.listen({ host, port });
  } catch (error) {
    await runtime.close();
    throw error;
  }
  runtime.cron.start();
  io.out(`${PRODUCT_NAME} ${VERSION} on ${address}`);
  io.out(`Root: ${root}`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await runtime.close();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

function databasePath(root: string): string {
  return join(root, 'data', 'app.db');
}

async function withDatabase<T>(
  root: string,
  body: (database: Database.Database) => T | Promise<T>,
): Promise<T> {
  if (!existsSync(databasePath(root)))
    throw new Error(
      `No ${PRODUCT_NAME} root at ${root}. Run \`${PRODUCT_SLUG} init\` first.`,
    );
  const database = new Database(databasePath(root), { fileMustExist: true });
  try {
    return await body(database);
  } finally {
    database.close();
  }
}

function usageError(io: CliIO, form: string): number {
  io.error(`Usage: ${PRODUCT_SLUG} ${form}`);
  return 2;
}
