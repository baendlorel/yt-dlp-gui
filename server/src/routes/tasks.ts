import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';

export async function registerTaskRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/tasks/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = ctx.service.cancelTask(id);
    if (!ok) return reply.code(409).send({ error: '任务无法取消（可能已结束）' });
    return { ok: true };
  });

  app.post('/api/tasks/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = ctx.service.retryTask(id);
    if (!task) return reply.code(404).send({ error: '任务不存在' });
    return { task };
  });

  app.post('/api/tasks/:id/reveal', async (request, reply) => {
    const { id } = request.params as { id: string };
    const path = ctx.service.revealTask(id);
    if (path === undefined) {
      const task = ctx.store.getTask(id);
      if (!task) return reply.code(404).send({ error: '任务不存在' });
    }
    return { ok: true };
  });

  app.delete('/api/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = ctx.service.removeTask(id);
    if (!removed) return reply.code(404).send({ error: '任务不存在' });
    return { ok: true };
  });

  app.delete('/api/tasks', async () => {
    const removed = ctx.service.clearFinishedTasks();
    ctx.hub.broadcast('refresh', { reason: 'cleared', removed });
    return { removed };
  });
}
