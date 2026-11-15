import type { ServerValue } from '@simplebot/shared';
import type { AppConfig } from '@simplebot/shared';
import { PrivateValues } from './secrets.js';

const REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;

/**
 * Resolve a saved value: plain text, an exact `${NAME}` environment reference,
 * or a private value. Missing sources never fall back to each other.
 */
export function resolveValue(
  source: ServerValue,
  label: string,
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof source !== 'string') {
    if (!('private' in source))
      throw new Error(`${label} private value was not saved`);
    const value = new PrivateValues(root).resolve(source.private);
    if (value === undefined)
      throw new Error(`${label} private value is not set; enter it again`);
    return value;
  }
  const name = REFERENCE.exec(source)?.[1];
  if (name === undefined) return source;
  const value = environment[name];
  if (value === undefined || value === '')
    throw new Error(`${label} environment variable ${name} is unavailable`);
  return value;
}

/** Resolve one saved provider connection for discovery or an immutable attempt. */
export function providerConnection(
  config: AppConfig['providers'][string],
  provider: string,
  root: string,
) {
  return {
    ...(config.apiKey === undefined
      ? {}
      : {
          apiKey: resolveValue(
            config.apiKey,
            `Provider ${JSON.stringify(provider)}`,
            root,
          ),
        }),
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  };
}
