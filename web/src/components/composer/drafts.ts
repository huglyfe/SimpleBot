/**
 * Per-session composer drafts.
 *
 * Deliberately module-level and ephemeral: a draft and its staged files are
 * per-browser UI state that must survive sheet opens and session switches, and
 * nothing more. They never reach disk and are cleared on a successful send.
 *
 * This is not a second authority. The engine owns nothing here — an unsent
 * draft is not a conversation fact, and losing it on reload is correct.
 *
 * Staged files stay `File` objects rather than the old client's data URLs:
 * `uploadAttachment` reads and base64-encodes at send time, so encoding here
 * would only mean doing it twice.
 */

export interface ComposerDraft {
  draft: string;
  files: File[];
}

export const MAX_STAGED_FILES = 8;
export const ACCEPTED_IMAGE_MIMES = ['image/png', 'image/jpeg'] as const;
const acceptedImageMimes = new Set<string>(ACCEPTED_IMAGE_MIMES);

const drafts = new Map<string, ComposerDraft>();

export function getDraft(sessionId: string): ComposerDraft | undefined {
  return drafts.get(sessionId);
}

export function saveDraft(
  sessionId: string,
  draft: string,
  files: File[],
): void {
  if (draft.length === 0 && files.length === 0) drafts.delete(sessionId);
  else drafts.set(sessionId, { draft, files });
}

/** Stable identity for a staged file, for React keys and remove-by-value. */
export function stagedKey(file: File): string {
  return `${file.name}:${String(file.size)}:${String(file.lastModified)}`;
}

export function acceptFiles(current: File[], incoming: File[]): File[] {
  const seen = new Set(current.map(stagedKey));
  const accepted = incoming.filter(
    (file) => acceptedImageMimes.has(file.type) && !seen.has(stagedKey(file)),
  );
  return [...current, ...accepted].slice(0, MAX_STAGED_FILES);
}
