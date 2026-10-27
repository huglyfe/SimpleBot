import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { CLIENT_NAMESPACE } from '@simplebot/shared';

import type Database from 'better-sqlite3';

/**
 * The session cookie, in its two forms. `__Host-` is the prefix a browser
 * only honours over HTTPS. Each transport reads only its own cookie.
 */
const COOKIE_NAME = `${CLIENT_NAMESPACE}_session`;

export class OwnerAuth {
  readonly #database: Database.Database;

  /**
   * Takes the caller's connection rather than opening its own: the server
   * shares `Storage`'s, and the pairing CLI is genuinely a second process.
   */
  constructor(database: Database.Database) {
    this.#database = database;
  }

  issuePairingCode(now = new Date()): { code: string; expiresAt: string } {
    const code = randomBytes(9).toString('base64url').toUpperCase();
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
    this.#database
      .prepare(
        `DELETE FROM auth_pairing_codes WHERE consumed_at IS NOT NULL OR expires_at <= ?`,
      )
      .run(now.toISOString());
    this.#database
      .prepare(
        `INSERT INTO auth_pairing_codes (id, code_hash, expires_at)
         VALUES (?, ?, ?)`,
      )
      .run(randomUUID(), hash(code), expiresAt);
    return { code, expiresAt };
  }

  setOwnerKey(key: string, now = new Date()): void {
    if (key.length < 16 || key.length > 128)
      throw new Error('Owner key must be 16-128 characters');
    this.#database
      .prepare(
        `INSERT INTO auth_settings (id, owner_key_hash, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET owner_key_hash = excluded.owner_key_hash,
           updated_at = excluded.updated_at`,
      )
      .run(hash(key), now.toISOString());
  }

  exchange(
    credential: string,
    now = new Date(),
    expiryDays = 30,
  ): { token: string; expiresAt: string | null } | null {
    return this.#database.transaction(() => {
      const digest = hash(credential.trim());
      const owner = this.#database
        .prepare(
          `SELECT owner_key_hash AS hash FROM auth_settings WHERE id = 1`,
        )
        .get() as { hash: string | null } | undefined;
      const pair = this.#database
        .prepare(
          `SELECT id, code_hash AS hash FROM auth_pairing_codes
           WHERE consumed_at IS NULL AND expires_at > ?`,
        )
        .all(now.toISOString()) as { id: string; hash: string }[];
      const match = pair.find((candidate) => equalHash(digest, candidate.hash));
      if (!equalHash(digest, owner?.hash) && match === undefined) return null;
      if (match !== undefined) {
        this.#database
          .prepare(`UPDATE auth_pairing_codes SET consumed_at = ? WHERE id = ?`)
          .run(now.toISOString(), match.id);
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = loginDeadline(now, expiryDays);
      this.#database
        .prepare(
          `INSERT INTO auth_sessions (id, token_hash, expires_at) VALUES (?, ?, ?)`,
        )
        .run(randomUUID(), hash(token), expiresAt);
      return { token, expiresAt };
    })();
  }

  verify(token: string | undefined, now = new Date()): boolean {
    if (token === undefined) return false;
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM auth_sessions
           WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .get(hash(token), now.toISOString()) !== undefined
    );
  }

  renew(
    token: string | undefined,
    now: Date,
    expiryDays: number,
  ): { expiresAt: string | null } | null {
    if (token === undefined) return null;
    const expiresAt = loginDeadline(now, expiryDays);
    const { changes } = this.#database
      .prepare(
        `UPDATE auth_sessions SET expires_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .run(expiresAt, hash(token), now.toISOString());
    return changes === 0 ? null : { expiresAt };
  }

  cleanup(now = new Date()): void {
    this.#database
      .prepare(
        `DELETE FROM auth_pairing_codes WHERE consumed_at IS NOT NULL OR expires_at <= ?`,
      )
      .run(now.toISOString());
    this.#database
      .prepare(
        `DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL OR expires_at <= ?`,
      )
      .run(now.toISOString());
  }

  purgeOthers(token: string, now = new Date()): boolean {
    return this.#database.transaction(() => {
      if (!this.verify(token, now)) return false;
      this.#database
        .prepare(`DELETE FROM auth_sessions WHERE token_hash <> ?`)
        .run(hash(token));
      return true;
    })();
  }

  revoke(token: string | undefined, now = new Date()): void {
    if (token === undefined) return;
    this.#database
      .prepare(
        `UPDATE auth_sessions SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .run(now.toISOString(), hash(token));
  }
}

export function authCookies(
  token: string,
  expiresAt: string | null,
  secure = true,
): string[] {
  const cookie = `${cookieName(secure)}=${token}; Path=/${expiresAt === null ? '' : `; Expires=${new Date(expiresAt).toUTCString()}`}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  return secure ? [cookie, clearedAuthCookie(false)] : [cookie];
}

/** The same cookie, expired. Logout has to name it exactly as issue did. */
export function clearedAuthCookies(secure = true): string[] {
  return secure
    ? [clearedAuthCookie(true), clearedAuthCookie(false)]
    : [clearedAuthCookie(false)];
}

function clearedAuthCookie(secure: boolean): string {
  return `${cookieName(secure)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function cookieName(secure: boolean): string {
  return `${secure ? '__Host-' : ''}${COOKIE_NAME}`;
}

export function readAuthCookie(
  source: string | undefined,
  secure: boolean,
): string | undefined {
  if (source === undefined) return undefined;
  for (const part of source.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName(secure)) return value.join('=') || undefined;
  }
  return undefined;
}

function loginDeadline(now: Date, expiryDays: number): string | null {
  return expiryDays === 0
    ? null
    : new Date(now.getTime() + expiryDays * 86_400_000).toISOString();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function equalHash(left: string, right: string | null | undefined): boolean {
  const a = Buffer.from(left, 'hex');
  const b = /^[a-f0-9]{64}$/u.test(right ?? '')
    ? Buffer.from(right ?? '', 'hex')
    : Buffer.alloc(32);
  return timingSafeEqual(a, b) && right !== null && right !== undefined;
}
