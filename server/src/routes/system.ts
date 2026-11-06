import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { writeCookieFile } from '../lib/cookies.js';
import { getEngine, invalidateEngineCache } from '../lib/engine.js';
import { clampInt, type Settings } from '../types.js';
import type { AppContext } from '../app.js';

function resolveDownloadDir(input: string): string {
  let value = input.trim();
  if (!value) throw new Error('下载目录不能为空');
  if (value === '~') value = os.homedir();
  else if (/^~[\\/]/.test(value)) value = path.join(os.homedir(), value.slice(2));
  const resolved = path.resolve(config.root, value);
  fs.mkdirSync(resolved, { recursive: true });
  const probe = path.join(resolved, `.write-test-${process.pid}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
  return resolved;
}

function buildSystem(ctx: AppContext) {
  const settings = ctx.store.state.settings;
  const status = getEngine(settings);
  const engine = status.engine;
  return {
    ok: status.ok,
    error: status.error ?? null,
    ytdlp: engine
      ? {
          mode: engine.mode,
          version: engine.version,
          file: engine.file,
          sourceDir: engine.ytdlpDir,
        }
      : null,
    ffmpeg: engine?.ffmpegPath ? { path: engine.ffmpegPath, version: engine.ffmpegVersion } : null,
    providers: ctx.registry.list().map((provider) => ({
      id: provider.id,
      label: provider.label,
      description: provider.description,
      examples: provider.examples,
      priority: provider.priority,
    })),
    queue: ctx.queue.stats,
    dirs: {
      downloadDir: settings.downloadDir,
      dataDir: config.dataDir,
      ytdlpDir: config.ytdlpDir,
      webDist: config.webDist,
      webBuilt: config.serveWeb,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      appVersion: '0.1.0',
    },
  };
}

export async function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, uptime: Math.round(process.uptime()) }));

  app.get('/api/system', async () => buildSystem(ctx));

  app.get('/api/providers', async () =>
    ctx.registry.list().map((provider) => ({
      id: provider.id,
      label: provider.label,
      description: provider.description,
      examples: provider.examples,
    })),
  );

  app.get('/api/state', async () => ({
    tasks: ctx.store.state.tasks,
    batches: ctx.store.state.batches,
    settings: ctx.store.publicSettings(),
    queue: ctx.queue.stats,
    serverTime: Date.now(),
  }));

  app.get('/api/settings', async () => ({ settings: ctx.store.publicSettings(), system: buildSystem(ctx) }));

  app.put('/api/settings', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const patch: Partial<Settings> = {};

    try {
      if (body.downloadDir !== undefined) {
        patch.downloadDir = resolveDownloadDir(String(body.downloadDir));
      }
    } catch (error) {
      return reply.code(400).send({
        error: `下载目录不可用：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (body.concurrency !== undefined) patch.concurrency = clampInt(body.concurrency, 1, 6, 2);
    if (body.fragmentConcurrency !== undefined) {
      patch.fragmentConcurrency = clampInt(body.fragmentConcurrency, 1, 16, 4);
    }
    if (body.maxPlaylistItems !== undefined) {
      patch.maxPlaylistItems = clampInt(body.maxPlaylistItems, 1, 500, 300);
    }
    if (body.organizeByProvider !== undefined) patch.organizeByProvider = Boolean(body.organizeByProvider);
    if (typeof body.cookie === 'string') {
      // 保留换行：解析器同时支持多行 Cookie 头和 Netscape cookies.txt
      patch.cookie = body.cookie.trim().slice(0, 16384);
    }
    if (body.clearCookie === true) patch.cookie = '';
    if (typeof body.ffmpegPath === 'string') patch.ffmpegPath = body.ffmpegPath.trim();
    if (typeof body.ytdlpPath === 'string') patch.ytdlpPath = body.ytdlpPath.trim();
    if (typeof body.pythonPath === 'string') patch.pythonPath = body.pythonPath.trim();

    ctx.store.updateSettings(patch);
    ctx.queue.setConcurrency(ctx.store.state.settings.concurrency);
    invalidateEngineCache();

    try {
      writeCookieFile(ctx.store.state.settings.cookie);
    } catch (error) {
      return reply.code(500).send({
        error: `Cookie 写入失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const settings = ctx.store.publicSettings();
    ctx.hub.broadcast('settings', settings);
    return { settings, system: buildSystem(ctx) };
  });
}
