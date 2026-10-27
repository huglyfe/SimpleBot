/** Product identity. Keep package names, executable names, formulae, and prose aligned. */

/** Display name, and the data-directory name on macOS and Windows. */
export const PRODUCT_NAME = 'SimpleBot';

/** Lowercase identity: executable, Linux data directory, MCP client name. */
export const PRODUCT_SLUG = 'simplebot';

/** Browser storage and authentication namespace. */
export const CLIENT_NAMESPACE = PRODUCT_SLUG;

/** One-line description, shared by the CLI banner and the package manifest. */
export const PRODUCT_TAGLINE =
  'a self-hosted conversation engine with persistent context';

/** The npm scope the artifact publishes under. */
const PACKAGE_SCOPE = '@huglyfe';

/** The published package name, as `npx` and the Homebrew formula spell it. */
export const PACKAGE_NAME = `${PACKAGE_SCOPE}/${PRODUCT_SLUG}`;

const ENV_PREFIX = PRODUCT_NAME.toUpperCase();

/** The environment namespace that overrides root resolution and the listener. */
export const ENV = {
  root: `${ENV_PREFIX}_ROOT`,
  host: `${ENV_PREFIX}_HOST`,
  port: `${ENV_PREFIX}_PORT`,
  tlsKey: `${ENV_PREFIX}_TLS_KEY`,
  tlsCert: `${ENV_PREFIX}_TLS_CERT`,
} as const;

/** Browser-local presentation keys use the product namespace. */
export const STORAGE_KEYS = {
  session: `${CLIENT_NAMESPACE}-session`,
  drawer: `${CLIENT_NAMESPACE}-drawer`,
  drawerWidth: `${CLIENT_NAMESPACE}-drawer-width`,
  appearance: `${CLIENT_NAMESPACE}-appearance`,
} as const;

/**
 * The window event the API layer raises when the server rejects a request for
 * want of pairing. Namespaced by slug so it cannot collide with a host page.
 */
export const AUTH_REQUIRED_EVENT = `${PRODUCT_SLUG}:authentication-required`;
