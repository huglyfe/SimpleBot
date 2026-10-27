import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { hasSystemError } from '@simplebot/shared';

import type { AuthoredFiles } from './authored.js';
import { resolveCredential } from './credentials.js';
import type { Storage } from './storage.js';

export class Speech {
  readonly #directory: string;
  readonly #storage: Storage;
  readonly #authored: AuthoredFiles;

  constructor(directory: string, storage: Storage, authored: AuthoredFiles) {
    this.#directory = directory;
    this.#storage = storage;
    this.#authored = authored;
  }

  async synthesize(sessionId: string, variantId: string, signal: AbortSignal) {
    const variant = this.#storage.variantSource(sessionId, variantId);
    if (hasSystemError(variant.source))
      throw new Error('A failed response cannot be synthesized');
    const authored = await this.#authored.readSessionSettings(
      variant.presetSlug,
    );
    const connection = authored.config.tts;
    if (connection === null) throw new Error('TTS is not configured');
    const identity = JSON.stringify({
      variantId,
      revision: variant.createdAt,
      source: variant.source,
      baseUrl: connection.baseUrl,
      model: connection.model,
      maxAudioBytes: connection.maxAudioBytes,
      voice: authored.preset.tts.voice,
      speed: authored.preset.tts.speed,
    });
    const key = `${createHash('sha256').update(identity).digest('hex')}.mp3`;
    const target = join(this.#directory, key);
    if (await exists(target)) return { key, cached: true };
    // A local TTS server needs no key, and sending `Bearer undefined` would be
    // a worse request than sending none.
    const apiKey = resolveCredential(
      connection.apiKey,
      'TTS',
      process.env,
      this.#authored.root,
    );
    const response = await fetch(
      new URL('audio/speech', trailingSlash(connection.baseUrl)),
      {
        method: 'POST',
        headers: {
          ...(apiKey === undefined
            ? {}
            : { authorization: `Bearer ${apiKey}` }),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: connection.model,
          input: variant.source,
          voice: authored.preset.tts.voice,
          speed: authored.preset.tts.speed,
          response_format: 'mp3',
        }),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(connection.timeoutMs),
        ]),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`TTS returned HTTP ${String(response.status)}`);
    }
    if (
      response.headers.get('content-type')?.split(';', 1)[0] !== 'audio/mpeg'
    ) {
      await response.body?.cancel();
      throw new Error('TTS did not return MP3 audio');
    }
    const data = await readBounded(response, connection.maxAudioBytes);
    await mkdir(this.#directory, { recursive: true });
    const temporary = join(this.#directory, `.${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return { key, cached: false };
  }

  async read(key: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}\.mp3$/u.test(key)) throw new Error('Invalid audio key');
    return readFile(join(this.#directory, key));
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isFile())
    .catch(() => false);
}

function trailingSlash(source: string): string {
  return source.endsWith('/') ? source : `${source}/`;
}

async function readBounded(
  response: Response,
  maximum: number,
): Promise<Buffer> {
  if (response.body === null) throw new Error('TTS returned no audio');
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > maximum) {
      throw new Error('TTS returned invalid audio size');
    }
    parts.push(part);
  }
  if (size === 0) throw new Error('TTS returned invalid audio size');
  return Buffer.concat(parts, size);
}
