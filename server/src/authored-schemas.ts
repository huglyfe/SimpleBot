/** Raw card/config schemas and file-specific validation failures. */
import { z } from 'zod';
import { type AppConfig, type Preset } from '@simplebot/shared';
export {
  appConfigSchema,
  dependencyConfigSchema,
  mcpDefinitionSchema,
  presetSchema,
  slug,
  credential,
  type AppConfig,
  type Preset,
  type BotCapability,
  type DependencyConfigDraft,
  type McpDefinition,
} from '@simplebot/shared';

export { cardSchema, botSettingsSchema } from '@simplebot/shared';
export type { Card, BotSettings } from '@simplebot/shared';

export interface AuthoredAttempt {
  config: AppConfig;
  writing: import('@simplebot/shared').Card;
  preset: Preset;
  bot: import('@simplebot/shared').BotSettings;
}

export class AuthoredConflictError extends Error {}

/**
 * An authored file that does not satisfy its own schema. The message names the
 * file, the field, and the expectation so the operator can fix the file without
 * reading a stack trace.
 */
export class AuthoredValidationError extends Error {}

export const MAX_BOT_PNG_BYTES = 10_000_000;

const MAX_REPORTED_ISSUES = 6;

function describeIssue(issue: z.core.$ZodIssue): string {
  const field =
    issue.path.length === 0
      ? 'the document root'
      : issue.path.map((part) => String(part)).join('.');
  return `${field}: ${issue.message}`;
}

/** Parses one authored document, naming the file in any validation failure. */
export function parseAuthored<T>(
  relativePath: string,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues;
  const reported = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => describeIssue(issue));
  const remaining = issues.length - reported.length;
  throw new AuthoredValidationError(
    `${relativePath} is not valid: ${reported.join('; ')}${
      remaining > 0 ? `; and ${String(remaining)} more problem(s)` : ''
    }`,
  );
}

/** Parses one authored document body, naming the file in a syntax failure. */
export function parseAuthoredJson(
  relativePath: string,
  source: string,
): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new AuthoredValidationError(
      `${relativePath} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
