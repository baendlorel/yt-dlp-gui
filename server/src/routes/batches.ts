import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../app.js';
import type { MediaItem } from '../types.js';

export async function registerBatchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/batches', async (request, reply) => {
    const body = (request.body ?? {}) as {
      urls?: string[] | string;
      items?: MediaItem[];
      options?: unknown;
      cookie?: string;
    };
    try {
      const batch = ctx.service.createBatch({
        urls: body.urls,
        items: body.items,
        options: body.options,
        cookie: body.cookie,
      });
      return reply.code(201).send({ batch });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.post('/api/batches/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const batch = ctx.service.cancelBatch(id);
    if (!batch) return reply.code(404).send({ error: '批次不存在' });
    return { batch };
  });

  app.post('/api/batches/:id/retry-failed', async (request, reply) => {
    const { id } = request.params as { id: string };
    const count = ctx.service.retryFailed(id);
    return { count };
  });

  app.delete('/api/batches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = ctx.service.removeBatch(id);
    if (!removed) return reply.code(404).send({ error: '批次不存在' });
    return { ok: true };
  });

  app.post('/api/resolve', async (request, reply) => {
    const body = (request.body ?? {}) as { urls?: string[] | string; limit?: number; cookie?: string };
    const urls = Array.isArray(body.urls)
      ? body.urls
      : typeof body.urls === 'string'
        ? body.urls.split(/\r?\n/)
        : [];
    if (urls.length === 0) return reply.code(400).send({ error: '请提供要解析的链接' });
    try {
      const fallback = ctx.store.state.settings.maxPlaylistItems;
      const limit = Math.min(500, Math.max(1, Number(body.limit) || fallback));
      const groups = await ctx.service.preview(urls, limit, body.cookie);
      return { groups };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/events', (request, reply: FastifyReply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');
    reply.raw.write(': connected\n\n');
    request.raw.socket.setTimeout(0);
    ctx.hub.add(reply.raw);
  });
}
