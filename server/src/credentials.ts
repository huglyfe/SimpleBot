import type { AppConfig } from './authored-schemas.js';
import { SecretStore } from './secrets.js';

const REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;

export function resolveCredential(
  source: string | undefined,
  label: string,
  environment: NodeJS.ProcessEnv = process.env,
  root?: string,
): string | undefined {
  if (source === undefined) return undefined;
  if (source.startsWith('secret:')) {
    const value =
      root === undefined
        ? undefined
        : new SecretStore(root).resolve(source.slice(7));
    if (value === undefined)
      throw new Error(`${label} saved secret is unavailable`);
    return value;
  }
  const name = REFERENCE.exec(source)?.[1];
  if (name === undefined)
    throw new Error(`${label} must be an environment reference`);
  const value = environment[name];
  if (value === undefined || value === '')
    throw new Error(`${label} credential reference is unavailable`);
  return value;
}

/** Resolve one saved provider connection for discovery or an immutable attempt. */
export function providerConnection(
  config: AppConfig['providers'][string],
  provider: string,
  root?: string,
) {
  const apiKey = resolveCredential(
    config.apiKey,
    `Provider ${JSON.stringify(provider)}`,
    process.env,
    root,
  );
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  };
}
