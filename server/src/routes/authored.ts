/** Character cards, bot config, artwork, PNG import, and presets. */

import { listSkills, readSkill, writeSkill, deleteSkill } from '../skills.js';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import {
  authoredDocumentWriteSchema,
  revisionRequestSchema,
  botImportRequestSchema,
  botArtworkWriteSchema,
  createBotRequestSchema,
} from '@simplebot/shared';
import {
  AuthoredConflictError,
  AuthoredValidationError,
  MAX_BOT_PNG_BYTES,
} from '../authored.js';
import type { RouteContext } from './context.js';

/**
 * Fastify decides a body's fate before any handler runs, so the bot
 * ceiling has to reach the route as a transport limit as well as a check.
 * Base64 costs four characters per three bytes; the rest is the JSON envelope.
 */
const BOT_UPLOAD_BODY_LIMIT = Math.ceil(MAX_BOT_PNG_BYTES / 3) * 4 + 4_096;

export function registerAuthoredRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  app.get('/api/skills', async () =>
    listSkills(ctx.authored.root).map(({ value, revision }) => ({
      value,
      revision,
    })),
  );
  app.get('/api/skills/:name', async (request) => {
    const { name } = request.params as { name: string };
    const { value, revision } = readSkill(ctx.authored.root, name);
    return { value, revision };
  });
  app.put('/api/skills/:name', async (request) => {
    const { name } = request.params as { name: string };
    const body = authoredDocumentWriteSchema.parse(request.body);
    return {
      revision: writeSkill(
        ctx.authored.root,
        name,
        body.value,
        body.expectedRevision,
      ),
    };
  });
  app.delete('/api/skills/:name', async (request) => {
    const { name } = request.params as { name: string };
    deleteSkill(
      ctx.authored.root,
      name,
      revisionRequestSchema.parse(request.body).expectedRevision,
    );
    return listSkills(ctx.authored.root).map(({ value, revision }) => ({
      value,
      revision,
    }));
  });

  app.post('/api/bots', async (request, reply) => {
    const { name } = createBotRequestSchema.parse(request.body);
    return reply.code(201).send(await ctx.authored.createBot(name));
  });

  app.post(
    '/api/bots/import',
    { bodyLimit: BOT_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      const body = botImportRequestSchema.parse(request.body);
      return reply.code(201).send(
        await ctx.authored.importBot({
          filename: body.filename,
          ...(body.name === undefined ? {} : { name: body.name }),
          data: decodeBotUpload(body.data),
        }),
      );
    },
  );

  app.get('/api/bots/:botSlug', async (request) => {
    const { botSlug } = request.params as { botSlug: string };
    return ctx.authored.readBotDocument(botSlug);
  });

  app.put('/api/bots/:botSlug', async (request) => {
    const { botSlug } = request.params as { botSlug: string };
    const body = authoredDocumentWriteSchema.parse(request.body);
    return {
      revision: await ctx.authored.writeBotDocument(
        botSlug,
        body.value,
        body.expectedRevision,
      ),
    };
  });

  app.get('/api/bots/:botSlug/avatar', async (request, reply) => {
    const { botSlug } = request.params as { botSlug: string };
    const artwork = await ctx.authored.avatar(botSlug);
    if (artwork === null)
      return reply.code(404).send({ error: 'No bot artwork' });
    return reply
      .type('image/png')
      .header('cache-control', 'no-cache')
      .send(await readFile(artwork.path));
  });

  app.put(
    '/api/bots/:botSlug/avatar',
    { bodyLimit: BOT_UPLOAD_BODY_LIMIT },
    async (request) => {
      const { botSlug } = request.params as { botSlug: string };
      const { data } = botArtworkWriteSchema.parse(request.body);
      await ctx.authored.replaceBotArtwork(botSlug, decodeBotUpload(data));
      const artwork = await ctx.authored.avatar(botSlug);
      if (artwork === null)
        throw new AuthoredValidationError('Bot artwork is missing');
      return { avatarUrl: artwork.url };
    },
  );

  app.delete('/api/presets/:presetSlug', async (request) => {
    const { presetSlug } = request.params as { presetSlug: string };
    const body = revisionRequestSchema.parse(request.body);
    if (
      ctx.storage
        .listSessions()
        .some((session) => session.presetSlug === presetSlug)
    )
      throw new AuthoredConflictError('Preset is used by a conversation');
    ctx.authored.deletePreset(presetSlug, body.expectedRevision);
    return { presets: await ctx.authored.listPresets() };
  });

  app.get('/api/presets/:presetSlug', async (request) => {
    const { presetSlug } = request.params as { presetSlug: string };
    return ctx.authored.readPresetDocument(presetSlug);
  });

  app.put('/api/presets/:presetSlug', async (request) => {
    const { presetSlug } = request.params as { presetSlug: string };
    const body = authoredDocumentWriteSchema.parse(request.body);
    return {
      revision: await ctx.authored.writePresetDocument(
        presetSlug,
        body.value,
        body.expectedRevision,
      ),
    };
  });
}

function decodeBotUpload(data: string): Buffer {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data))
    throw new AuthoredValidationError('Bot upload data is not valid base64');
  return Buffer.from(data, 'base64');
}
