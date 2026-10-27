/**
 * The two failures storage reports to its callers. They live apart from the
 * class only so the row decoders can raise them without importing it back.
 */
export class StorageConflictError extends Error {}
export class StorageNotFoundError extends Error {}
