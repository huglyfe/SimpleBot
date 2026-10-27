import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { appConfigSchema, secretNameSchema } from '@simplebot/shared';
import { AuthoredConflictError } from './authored-schemas.js';

const secretsSchema = z.record(secretNameSchema, z.string().min(1).max(16_384));

/** Private file authority. Synchronous mutations cannot interleave in this process. */
export class SecretStore {
  constructor(readonly root: string) {}

  private read() {
    let source = '{}';
    let fd: number | undefined;
    try {
      fd = openSync(
        join(this.root, 'secrets.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size > 2_097_152 ||
        (process.platform !== 'win32' &&
          (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
      )
        throw new Error('Invalid private store');
      source = readFileSync(fd, 'utf8');
      const values = secretsSchema.parse(JSON.parse(source));
      return {
        values,
        revision: createHash('sha256').update(source).digest('hex'),
      };
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        // Parser errors can contain secret material; never retain their cause.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(
          'Secret store is unreadable, invalid, or not private (0600 required).',
        );
      return {
        values: {} as Record<string, string>,
        revision: createHash('sha256').update(source).digest('hex'),
      };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  list() {
    const { values, revision } = this.read();
    return { names: Object.keys(values).sort(), revision };
  }

  resolve(name: string): string | undefined {
    const { values } = this.read();
    return Object.hasOwn(values, name) ? values[name] : undefined;
  }

  write(name: string, value: string | null, expectedRevision: string) {
    secretNameSchema.parse(name);
    const current = this.read();
    if (current.revision !== expectedRevision)
      throw new AuthoredConflictError('Secrets changed; reload and try again.');
    if (value === null) {
      const config = appConfigSchema.parse(
        JSON.parse(readFileSync(join(this.root, 'config.json'), 'utf8')),
      );
      const users: string[] = [];
      const reference = `secret:${name}`;
      for (const [id, provider] of Object.entries(config.providers))
        if (provider.apiKey === reference) users.push(`provider ${id}`);
      if (config.tts?.apiKey === reference) users.push('TTS');
      for (const [id, server] of Object.entries({
        ...config.mcpServers,
        ...config.memoryServers,
      }))
        if (
          Object.values(
            server.type === 'stdio' ? server.env : server.headers,
          ).includes(reference)
        )
          users.push(`server ${id}`);
      if (users.length > 0)
        throw new AuthoredConflictError(
          `Secret is used by ${users.join(', ')}. Save their new references before removing it.`,
        );
    }
    const values = { ...current.values };
    if (value === null) delete values[name];
    else values[name] = value;
    const source = JSON.stringify(secretsSchema.parse(values), null, 2) + '\n';
    if (Buffer.byteLength(source) > 2_097_152)
      throw new Error('Secret store is full.');
    const temporary = join(this.root, `.secrets-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, source, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, join(this.root, 'secrets.json'));
    } catch {
      throw new Error('Could not save the secret store.');
    } finally {
      rmSync(temporary, { force: true });
    }
    return this.list();
  }
}
