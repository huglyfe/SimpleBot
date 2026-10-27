import { useMemo, useRef, useState } from 'react';
import type { DefinedUseQueryResult } from '@tanstack/react-query';
import { isAuthoredConflict } from '../../api.js';
import { errorMessage } from '../../lib/errorMessage.js';

export interface AuthoredSource<T> {
  value: T;
  revision: string;
}
export type AuthoredQuery<T> = Pick<
  DefinedUseQueryResult<AuthoredSource<T>>,
  'data' | 'refetch' | 'error'
>;

/** One panel draft and revision; every explicit save commits this draft once. */
export function useAuthoredEditor<T>({
  query,
  save,
}: {
  query: AuthoredQuery<T>;
  save: (value: T, revision: string) => Promise<AuthoredSource<T>>;
}) {
  const [snapshot, setSnapshot] = useState(query.data);
  const [value, change] = useState(snapshot.value);
  const form = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    conflict: boolean;
  } | null>(null);
  function adopt(next: AuthoredSource<T>): void {
    change(next.value);
    setSnapshot(next);
  }
  const savedSource = useMemo(
    () => JSON.stringify(snapshot.value),
    [snapshot.value],
  );
  const changed = useMemo(
    () => JSON.stringify(value) !== savedSource,
    [value, savedSource],
  );
  function discard(): void {
    if (busy.current) return;
    change(snapshot.value);
    setFailure(null);
  }
  async function update(): Promise<void> {
    if (form.current && !form.current.checkValidity())
      throw new Error(
        'Complete the required fields with valid values before saving.',
      );
    if (busy.current) throw new Error('A save is already in progress.');
    if (!changed) return;
    busy.current = true;
    setSaving(true);
    setFailure(null);
    try {
      adopt(await save(value, snapshot.revision));
    } catch (error) {
      setFailure({
        message: errorMessage(error, 'Save failed'),
        conflict: isAuthoredConflict(error),
      });
      throw error;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function reloadLatest(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const latest = await query.refetch({ throwOnError: true });
      if (latest.data === undefined) throw new Error('Reload failed');
      adopt(latest.data);
    } catch (error) {
      setFailure({
        message: errorMessage(error, 'Reload failed'),
        conflict: true,
      });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return {
    value,
    savedValue: snapshot.value,
    form,
    discard,
    changed,
    revision: snapshot.revision,
    update,
    saving,
    reloadLatest,
    change,
    error: failure?.message ?? query.error?.message ?? null,
    conflict: failure?.conflict ?? false,
  };
}
