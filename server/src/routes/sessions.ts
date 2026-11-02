/** Session lifecycle, transcript paging, search, and the Context projection. */

import type {
  Bootstrap,
  SessionProjection,
  SessionSearchResponse,
} from '@simplebot/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  createSessionRequestSchema,
  sessionTitleRequestSchema,
  sessionPresetRequestSchema,
} from '@simplebot/shared';
import { VERSION } from '../root.js';
import { StorageConflictError, StorageNotFoundError } from '../storage.js';
import { searchSessions } from '../storage.js';
import type { RouteContext } from './context.js';

export function registerSessionRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  app.get('/api/bootstrap', async (): Promise<Bootstrap> => {
    const bots = await ctx.authored.listBots();
    const sessions = ctx.storage.listSessions();
    const known = new Set(bots.map((bot) => bot.slug));
    for (const { botSlug } of sessions) {
      if (known.has(botSlug)) continue;
      known.add(botSlug);
      bots.push({ slug: botSlug, name: botSlug, avatarUrl: null });
    }
    const { value: config } = await ctx.authored.readConfig();
    return {
      version: VERSION,
      ttsConfigured: config.tts !== null,
      time: {
        timezone: config.application.timezone,
        clockFormat: config.application.clockFormat,
      },
      bots,
      sessions,
    };
  });

  // Cross-session, cross-bot: one operator owns every conversation here.
  app.get('/api/search', async (request) => {
    const { q = '' } = request.query as { q?: string };
    return {
      results: searchSessions(ctx.storage.statements, q, 50),
    } satisfies SessionSearchResponse;
  });

  app.post('/api/sessions', async (request, reply) => {
    const body = createSessionRequestSchema.parse(request.body);
    const presetSlug = await ctx.authored.resolveSessionPreset(
      body.botSlug,
      body.presetSlug,
    );
    const createdAt = ctx.now().toISOString();
    const session = ctx.storage.createSession({
      id: randomUUID(),
      botSlug: body.botSlug,
      presetSlug,
      greetings: await ctx.authored.readGreetings(body.botSlug),
      now: createdAt,
    });
    return reply.code(201).send({
      id: session.id,
      botSlug: session.botSlug,
      presetSlug: session.presetSlug,
      createdAt: session.createdAt,
    });
  });

  app.get('/api/sessions/:sessionId', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return {
      ...ctx.storage.projection(sessionId),
      activeAttemptId: ctx.attempts.activeAttemptId(sessionId),
    } satisfies SessionProjection;
  });

  app.patch('/api/sessions/:sessionId/preset', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { presetSlug } = sessionPresetRequestSchema.parse(request.body);
    await ctx.authored.readPresetDocument(presetSlug);
    ctx.storage.setSessionPreset(
      sessionId,
      presetSlug,
      ctx.now().toISOString(),
    );
    return reply.code(204).send();
  });

  app.patch('/api/sessions/:sessionId/title', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const { title } = sessionTitleRequestSchema.parse(request.body);
    ctx.storage.setSessionTitle(sessionId, title, ctx.now().toISOString());
    return { title };
  });

  app.delete('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    await ctx.storage.deleteSession(sessionId);
    return reply.code(204).send();
  });

  app.get('/api/sessions/:sessionId/context', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    return ctx.sessionContext(sessionId);
  });

  app.get('/api/sessions/:sessionId/positions', async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const { before } = request.query as { before?: string };
    if (ctx.storage.sessionIdentity(sessionId) === null)
      throw new StorageNotFoundError('Session not found');
    const bound = before === undefined ? null : Number(before);
    if (
      bound !== null &&
      (before?.trim() === '' || !Number.isSafeInteger(bound) || bound < 0)
    )
      throw new StorageConflictError('before must be a position ordinal');
    return ctx.storage.transcriptPage(sessionId, bound);
  });
}
