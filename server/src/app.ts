/**
 * The one authenticated client boundary: transport, the pairing gate, static
 * assets, and the error mapping every surface shares. The surfaces themselves
 * live in `routes/`, each registered against the same instance and the same
 * context, so nothing here grows when one of them does.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

import { authCookies, readAuthCookie } from './auth.js';
import { AuthoredConflictError, AuthoredValidationError } from './authored.js';
import { registerAttemptRoutes } from './routes/attempts.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAuthoredRoutes } from './routes/authored.js';
import { registerConversationRoutes } from './routes/conversation.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerSettingsRoutes } from './routes/settings.js';
import {
  createRouteContext,
  type RouteDependencies,
} from './routes/context.js';
import { StorageConflictError, StorageNotFoundError } from './storage.js';

export function createApp(
  options: RouteDependencies & {
    webRoot?: string;
    clock?: () => Date;
    tls?: { key: Buffer; cert: Buffer };
  },
): FastifyInstance {
  const app = Fastify({
    logger: false,
    ...(options.tls === undefined ? {} : { https: options.tls }),
  });
  const now = options.clock ?? (() => new Date());
  const loginEnabled = options.loginEnabled;
  const ctx = createRouteContext(options, now);

  if (options.webRoot !== undefined) {
    void app.register(fastifyStatic, {
      root: options.webRoot,
      prefix: '/',
      index: ['index.html'],
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    // Authorize the route Fastify actually matched, including absolute-form
    // request targets. The raw URL can spell that same route differently.
    const path = request.routeOptions.url ?? '';
    if (
      !loginEnabled &&
      !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/iu.test(
        request.headers.host ?? '',
      )
    )
      return reply.code(403).send({ error: 'Loopback Host required' });
    if (
      path.startsWith('/api/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      const origin = request.headers.origin;
      if (
        origin !== undefined &&
        origin !== `${request.protocol}://${request.headers.host ?? ''}`
      )
        return reply.code(403).send({ error: 'Cross-origin write rejected' });
    }
    const status = path === '/api/auth/status';
    const required =
      path.startsWith('/api/') &&
      (loginEnabled || path === '/api/auth/purge-others') &&
      path !== '/api/health' &&
      (!path.startsWith('/api/auth/') || path === '/api/auth/purge-others');
    if (!required && !status) return;
    const secure = request.protocol === 'https';
    const token = readAuthCookie(request.headers.cookie, secure);
    if (token !== undefined) {
      const { value } = await options.authored.readConfig();
      const renewed = options.auth.renew(
        token,
        now(),
        value.application.browserLoginExpiryDays,
      );
      if (renewed !== null) {
        reply.header(
          'set-cookie',
          authCookies(token, renewed.expiresAt, secure),
        );
        return;
      }
    }
    if (required) return reply.code(401).send({ error: 'Pairing required' });
  });

  options.auth.cleanup(now());
  const authCleanup = setInterval(
    () => options.auth.cleanup(now()),
    24 * 60 * 60_000,
  );
  authCleanup.unref();
  app.addHook('onClose', async () => {
    clearInterval(authCleanup);
  });

  registerAuthRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerAuthoredRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerConversationRoutes(app, ctx);
  registerAttemptRoutes(app, ctx);

  app.setErrorHandler((error, _request, reply) => {
    const caught = error instanceof Error ? error : new Error(String(error));
    const status =
      'code' in caught && caught.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? 413
        : caught.name === 'ZodError' ||
            caught instanceof AuthoredValidationError
          ? 400
          : caught instanceof StorageNotFoundError
            ? 404
            : caught instanceof StorageConflictError ||
                caught instanceof AuthoredConflictError
              ? 409
              : 500;
    void reply.code(status).send({ error: caught.message });
  });

  return app;
}
