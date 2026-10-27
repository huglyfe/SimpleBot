/** The one streaming attempt endpoint and its cancellation. */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { attemptCommandSchema } from '@simplebot/shared';
import type { RouteContext } from './context.js';

export function registerAttemptRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  app.post('/api/sessions/:sessionId/attempts', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (ctx.storage.sessionIdentity(sessionId) === null) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    const command = attemptCommandSchema.parse(request.body);
    const attemptId = randomUUID();
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.raw.writeHead(200, {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
      'x-attempt-id': attemptId,
    });
    const { done } = ctx.attempts.enqueue({
      id: attemptId,
      sessionId,
      command,
      emit(event) {
        if (reply.raw.destroyed) return;
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    });
    await done;
    if (!reply.raw.destroyed) reply.raw.end();
  });

  app.delete(
    '/api/sessions/:sessionId/attempts/:attemptId',
    async (request, reply) => {
      const { sessionId, attemptId } = request.params as {
        sessionId: string;
        attemptId: string;
      };
      if (!ctx.attempts.cancel(sessionId, attemptId)) {
        return reply.code(404).send({ error: 'Attempt not found' });
      }
      return reply.code(202).send({ cancelled: true });
    },
  );
}
