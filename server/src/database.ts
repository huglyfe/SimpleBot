import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/**
 * The schema version this build writes and reads. `schema.sql` stamps the same
 * number, and a fresh database is checked against it on creation, so the two
 * cannot drift silently.
 */
export const SCHEMA_VERSION = 17;

const expectedTables = [
  'attachments',
  'auth_pairing_codes',
  'auth_sessions',
  'auth_settings',
  'effects',
  'leaves',
  'message_positions',
  'message_variants',
  'schedules',
  'search_documents',
  'search_fts',
  'search_fts_config',
  'search_fts_data',
  'search_fts_docsize',
  'search_fts_idx',
  'session_todos',
  'session_variables',
  'sessions',
] as const;

/** Initialize or validate the schema without completing interrupted runtime work. */
export async function initializeDatabase(
  databasePath: string,
  schemaPath: string,
): Promise<void> {
  const database = await openDatabase(databasePath, schemaPath);
  database.close();
}

export async function openDatabase(
  databasePath: string,
  schemaPath: string,
): Promise<Database.Database> {
  await mkdir(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  try {
    // WAL keeps the readers this root genuinely has — the doctor, the pairing
    // CLI, an online backup — from blocking an attempt's writes.
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    if (tables.length === 0) database.exec(readFileSync(schemaPath, 'utf8'));
    assertCurrentSchema(database);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

/** The shape every statement in this module is written against. */
export function assertCurrentSchema(database: Database.Database): void {
  const version = database.pragma('user_version', { simple: true });
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => (row as { name: string }).name);
  if (
    version !== SCHEMA_VERSION ||
    JSON.stringify(tables) !== JSON.stringify(expectedTables)
  )
    throw new Error(
      `This database does not match schema ${String(SCHEMA_VERSION)}. Use its matching SimpleBot build or back up the root and arrange an explicit conversion; startup does not migrate data.`,
    );
}
