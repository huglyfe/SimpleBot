/** Health, pairing status, and the two session-cookie routes. */

import type { FastifyInstance } from 'fastify';
import { authExchangeRequestSchema } from '@simplebot/shared';
import { authCookies, clearedAuthCookies, readAuthCookie } from '../auth.js';
import type { RouteContext } from './context.js';

export function registerAuthRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/auth/status', async (request) => ({
    loginEnabled: ctx.loginEnabled,
    authenticated: ctx.auth.verify(
      readAuthCookie(request.headers.cookie, request.protocol === 'https'),
      ctx.now(),
    ),
  }));

  app.post('/api/auth/exchange', async (request, reply) => {
    const { credential } = authExchangeRequestSchema.parse(request.body);
    const { value } = await ctx.authored.readConfig();
    const issued = ctx.auth.exchange(
      credential,
      ctx.now(),
      value.application.browserLoginExpiryDays,
    );
    if (issued === null)
      return reply.code(401).send({ error: 'Invalid credential' });
    const secure = request.protocol === 'https';
    return reply
      .header('set-cookie', authCookies(issued.token, issued.expiresAt, secure))
      .send({ authenticated: true, expiresAt: issued.expiresAt });
  });

  app.post('/api/auth/purge-others', async (request, reply) => {
    const token = readAuthCookie(
      request.headers.cookie,
      request.protocol === 'https',
    );
    if (token === undefined || !ctx.auth.purgeOthers(token, ctx.now()))
      return reply.code(401).send({ error: 'Pairing required' });
    return reply.code(204).send();
  });

  app.post('/api/auth/logout', async (request, reply) => {
    ctx.auth.revoke(
      readAuthCookie(request.headers.cookie, request.protocol === 'https'),
      ctx.now(),
    );
    return reply
      .header('set-cookie', clearedAuthCookies(request.protocol === 'https'))
      .code(204)
      .send();
  });
}
