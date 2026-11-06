import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import type { StateStore } from './lib/store.js';
import type { TaskQueue } from './lib/queue.js';
import type { EventHub } from './lib/events.js';
import type { ProviderRegistry } from './providers/registry.js';
import type { DownloadService } from './services/downloadService.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerBatchRoutes } from './routes/batches.js';
import { registerTaskRoutes } from './routes/tasks.js';

export interface AppContext {
  store: StateStore;
  queue: TaskQueue;
  hub: EventHub;
  registry: ProviderRegistry;
  service: DownloadService;
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 4 * 1024 * 1024,
  });

  await registerSystemRoutes(app, ctx);
  await registerBatchRoutes(app, ctx);
  await registerTaskRoutes(app, ctx);

  if (config.serveWeb && fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '/';
    if (url.startsWith('/api/')) {
      return reply.code(404).send({ error: '接口不存在' });
    }
    if (config.serveWeb && fs.existsSync(config.webDist)) {
      return reply.sendFile('index.html');
    }
    return reply.code(200).send({
      name: 'yt-dlp-gui',
      message: '后端已启动。开发模式请访问 Vite 地址（默认 http://127.0.0.1:5173），或先执行 pnpm build 由后端托管前端。',
    });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({ error: err.message || '服务器内部错误' });
  });

  return app;
}
