import { closeSync, openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tryLock } from 'fs-native-extensions';

/** The OS owns the lock; the empty file stays so every start locks the same inode. */
export async function acquireRuntimeOwnership(
  databasePath: string,
): Promise<() => void> {
  await mkdir(dirname(databasePath), { recursive: true });
  const fd = openSync(`${databasePath}.runtime-lock`, 'a+', 0o600);
  try {
    if (!tryLock(fd))
      throw new Error(
        'Another SimpleBot runtime owns this root. Stop it before starting another server.',
      );
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return () => closeSync(fd);
}
