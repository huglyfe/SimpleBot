/** Everything that mutates one conversation: state, messages, effects, media. */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  unknownRecordSchema,
  todoCreateSchema,
  todoUpdateSchema,
  editLeafRequestSchema,
  editSourceRequestSchema,
  selectVariantRequestSchema,
  uploadAttachmentRequestSchema,
  scheduleWriteSchema,
  variableWriteSchema,
} from '@simplebot/shared';
import {
  MAX_ATTACHMENT_BYTES,
  StorageConflictError,
  StorageNotFoundError,
} from '../storage.js';
import type { RouteContext } from './context.js';

/** The attachment ceiling reaches the upload route as a transport limit too. */
const UPLOAD_BODY_LIMIT = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4_096;

export function registerConversationRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  app.post('/api/sessions/:sessionId/todos', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    ctx.storage.addTodo(
      sessionId,
      { id: randomUUID(), ...todoCreateSchema.parse(request.body) },
      ctx.now().toISOString(),
    );
    return reply.code(204).send();
  });

  app.patch(
    '/api/sessions/:sessionId/todos/:todoId',
    async (request, reply) => {
      const { sessionId, todoId } = request.params as {
        sessionId: string;
        todoId: string;
      };
      ctx.storage.updateTodo(
        sessionId,
        todoUpdateSchema.parse({
          ...unknownRecordSchema.parse(request.body),
          id: todoId,
        }),
        ctx.now().toISOString(),
      );
      return reply.code(204).send();
    },
  );

  app.put('/api/sessions/:sessionId/variables', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { name, value, previousName } = variableWriteSchema.parse(
      request.body,
    );
    ctx.storage.setVariable(
      sessionId,
      name,
      value,
      ctx.now().toISOString(),
      previousName,
    );
    return reply.code(204).send();
  });

  app.delete(
    '/api/sessions/:sessionId/variables/:name',
    async (request, reply) => {
      const { sessionId, name } = request.params as {
        sessionId: string;
        name: string;
      };
      ctx.storage.deleteVariable(sessionId, name, ctx.now().toISOString());
      return reply.code(204).send();
    },
  );

  app.put('/api/sessions/:sessionId/schedules', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = scheduleWriteSchema.parse(request.body);
    const timezone = (await ctx.authored.readConfig()).value.application
      .timezone;
    ctx.storage.putSchedule(
      {
        ...body,
        id: body.id ?? randomUUID(),
        sessionId,
        now: ctx.now().toISOString(),
      },
      timezone,
    );
    ctx.cron.wake(timezone);
    return reply.code(204).send();
  });

  app.delete(
    '/api/sessions/:sessionId/schedules/:scheduleId',
    async (request, reply) => {
      const { sessionId, scheduleId } = request.params as {
        sessionId: string;
        scheduleId: string;
      };
      ctx.storage.deleteSchedule(
        sessionId,
        scheduleId,
        ctx.now().toISOString(),
      );
      const timezone = (await ctx.authored.readConfig()).value.application
        .timezone;
      ctx.cron.wake(timezone);
      return reply.code(204).send();
    },
  );

  app.patch(
    '/api/sessions/:sessionId/positions/:positionId/selection',
    async (request) => {
      const { sessionId, positionId } = request.params as {
        sessionId: string;
        positionId: string;
      };
      const { direction } = selectVariantRequestSchema.parse(request.body);
      ctx.storage.selectAdjacentVariant({
        sessionId,
        positionId,
        direction,
        now: ctx.now().toISOString(),
      });
      return ctx.change(sessionId, { positionIds: [positionId] });
    },
  );

  app.post(
    '/api/sessions/:sessionId/positions/:positionId/accept',
    async (request) => {
      const { sessionId, positionId } = request.params as {
        sessionId: string;
        positionId: string;
      };
      await ctx.attempts.acceptPosition(sessionId, positionId);
      return ctx.change(sessionId, { positionIds: [positionId] });
    },
  );

  app.post('/api/sessions/:sessionId/compact', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    await ctx.attempts.requestCompaction(sessionId);
    return reply.code(204).send();
  });

  app.patch(
    '/api/sessions/:sessionId/positions/:positionId/source',
    async (request) => {
      const { sessionId, positionId } = request.params as {
        sessionId: string;
        positionId: string;
      };
      const { source } = editSourceRequestSchema.parse(request.body);
      ctx.storage.editPositionSource({
        sessionId,
        positionId,
        source,
        now: ctx.now().toISOString(),
      });
      return ctx.change(sessionId, { positionIds: [positionId] });
    },
  );

  app.patch(
    '/api/sessions/:sessionId/variants/:variantId/source',
    async (request) => {
      const { sessionId, variantId } = request.params as {
        sessionId: string;
        variantId: string;
      };
      const { source } = editSourceRequestSchema.parse(request.body);
      const { positionId } = ctx.storage.editVariantSource({
        sessionId,
        variantId,
        source,
        now: ctx.now().toISOString(),
      });
      return ctx.change(sessionId, { positionIds: [positionId] });
    },
  );

  app.delete(
    '/api/sessions/:sessionId/variants/:variantId',
    async (request) => {
      const { sessionId, variantId } = request.params as {
        sessionId: string;
        variantId: string;
      };
      const { positionId } = ctx.storage.deleteVariant({
        sessionId,
        variantId,
        now: ctx.now().toISOString(),
      });
      return ctx.change(sessionId, { positionIds: [positionId] });
    },
  );

  app.post(
    '/api/sessions/:sessionId/effects/:effectId/resolve',
    async (request) => {
      const { sessionId, effectId } = request.params as {
        sessionId: string;
        effectId: string;
      };
      const { positionId } = ctx.storage.resolveEffect({
        sessionId,
        effectId,
        now: ctx.now().toISOString(),
      });
      return ctx.change(sessionId, { positionIds: [positionId] });
    },
  );

  app.patch(
    '/api/sessions/:sessionId/leaves/:leafId/source',
    async (request, reply) => {
      const { sessionId, leafId } = request.params as {
        sessionId: string;
        leafId: string;
      };
      const { source } = editLeafRequestSchema.parse(request.body);
      ctx.storage.editLeaf({
        sessionId,
        leafId,
        summary: source,
        now: ctx.now().toISOString(),
      });
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/sessions/:sessionId/attachments',
    { bodyLimit: UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const body = uploadAttachmentRequestSchema.parse(request.body);
      if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(body.data)) {
        throw new StorageConflictError('Attachment data is not valid base64');
      }
      const limits = await ctx.authored.readApplication();
      const attachment = await ctx.storage.importAttachment({
        sessionId,
        filename: body.filename,
        data: Buffer.from(body.data, 'base64'),
        maxDimension: limits.maxImageDimension,
        now: ctx.now().toISOString(),
      });
      return reply.code(201).send(attachment);
    },
  );

  /**
   * Releases one uploaded attachment that no turn ever claimed, named by its
   * exact ID. Uploads happen before the attempt exists, so a send whose upload
   * batch fails part-way is the one window the attempt's own cleanup cannot
   * cover: the client deletes exactly the IDs it just created. The unbound
   * guard in storage is what keeps this a release rather than a decision — an
   * attachment a committed turn owns cannot match.
   */
  app.delete(
    '/api/sessions/:sessionId/attachments/:attachmentId',
    async (request, reply) => {
      const { sessionId, attachmentId } = request.params as {
        sessionId: string;
        attachmentId: string;
      };
      if (ctx.storage.sessionIdentity(sessionId) === null)
        throw new StorageNotFoundError('Session not found');
      await ctx.storage.discardUnboundAttachments(sessionId, [attachmentId]);
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/sessions/:sessionId/attachments/:attachmentId',
    async (request, reply) => {
      const { sessionId, attachmentId } = request.params as {
        sessionId: string;
        attachmentId: string;
      };
      const attachment = await ctx.storage.readSessionAttachment(
        sessionId,
        attachmentId,
      );
      return reply
        .type(attachment.mimeType)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(attachment.data);
    },
  );

  app.post(
    '/api/sessions/:sessionId/variants/:variantId/speech',
    async (request, reply) => {
      const { sessionId, variantId } = request.params as {
        sessionId: string;
        variantId: string;
      };
      const controller = new AbortController();
      reply.raw.once('close', () => controller.abort());
      const result = await ctx.speech.synthesize(
        sessionId,
        variantId,
        controller.signal,
      );
      return reply.send({ ...result, url: `/api/audio/${result.key}` });
    },
  );

  app.get('/api/audio/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    return reply.type('audio/mpeg').send(await ctx.speech.read(key));
  });
}
