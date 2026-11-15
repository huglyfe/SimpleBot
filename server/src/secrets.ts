import { randomBytes, randomUUID } from 'node:crypto';
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
import {
  mapServerValues,
  privateReference,
  type AppConfig,
} from '@simplebot/shared';

const MAX_BYTES = 2_097_152;
const valuesSchema = z.record(
  privateReference.shape.private,
  z.string().min(1).max(16_384),
);

/**
 * Private file authority for write-only values. Config holds only opaque IDs;
 * synchronous reads and writes cannot interleave in this process.
 */
export class PrivateValues {
  constructor(readonly root: string) {}

  #read(): Record<string, string> {
    let fd: number | undefined;
    try {
      fd = openSync(
        join(this.root, 'secrets.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size > MAX_BYTES ||
        (process.platform !== 'win32' &&
          (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
      )
        throw new Error('Invalid private store');
      return valuesSchema.parse(JSON.parse(readFileSync(fd, 'utf8')));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return {};
      // Parser errors can contain private material; never retain their cause.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        'Private values are unreadable, invalid, or not private (0600 required).',
      );
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  resolve(id: string): string | undefined {
    const values = this.#read();
    return Object.hasOwn(values, id) ? values[id] : undefined;
  }

  /**
   * Store the candidate's new values under fresh IDs and return the config to
   * publish. Values referenced by the prior config stay until a later save, so
   * a failed config publish never strands the configuration still on disk.
   */
  admit(prior: AppConfig, candidate: AppConfig): AppConfig {
    const current = this.#read();
    const added: Record<string, string> = {};
    const saved = mapServerValues(candidate, (value) => {
      if (typeof value === 'string' || !('value' in value)) return value;
      const id = randomBytes(16).toString('hex');
      added[id] = value.value;
      return { private: id };
    });
    const keep = new Set([...privateIds(prior), ...privateIds(saved)]);
    const retained = Object.fromEntries(
      Object.entries(current).filter(([id]) => keep.has(id)),
    );
    if (
      Object.keys(added).length > 0 ||
      Object.keys(retained).length !== Object.keys(current).length
    )
      this.#write({ ...retained, ...added });
    return saved;
  }

  #write(values: Record<string, string>): void {
    const source = `${JSON.stringify(values, null, 2)}\n`;
    if (Buffer.byteLength(source) > MAX_BYTES)
      throw new Error('Private value storage is full.');
    const temporary = join(this.root, `.secrets-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, source, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, join(this.root, 'secrets.json'));
    } catch {
      throw new Error('Could not save private values.');
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

function privateIds(config: AppConfig): string[] {
  const ids: string[] = [];
  mapServerValues(config, (value) => {
    if (typeof value !== 'string' && 'private' in value)
      ids.push(value.private);
    return value;
  });
  return ids;
}
