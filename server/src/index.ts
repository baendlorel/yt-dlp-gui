import { buildApp } from './app.js';
import { config, ensureDirs } from './config.js';
import { clearBatchCookieFiles, writeCookieFile } from './lib/cookies.js';
import { EventHub } from './lib/events.js';
import { getEngine } from './lib/engine.js';
import { TaskQueue } from './lib/queue.js';
import { StateStore } from './lib/store.js';
import { createRegistry } from './providers/registry.js';
import { DownloadService } from './services/downloadService.js';

async function main(): Promise<void> {
  ensureDirs();
  clearBatchCookieFiles();

  const store = new StateStore();
  store.load();
  // 把已保存的 Cookie 同步成 yt-dlp 可用的 cookies.txt，并清理已失效的旧文件
  try {
    writeCookieFile(store.state.settings.cookie);
  } catch (error) {
    console.error(`Cookie 文件初始化失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const queue = new TaskQueue(store.state.settings.concurrency);
  const hub = new EventHub();
  const registry = createRegistry();
  const service = new DownloadService(store, queue, hub, registry);

  const app = await buildApp({ store, queue, hub, registry, service });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    console.error(`\n无法启动服务：${error instanceof Error ? error.message : String(error)}`);
    console.error(`请检查端口 ${config.port} 是否被占用，或修改 .env 中的 PORT。\n`);
    process.exit(1);
  }

  const engine = getEngine(store.state.settings);
  const lines = [
    '',
    '  BiliFlow · yt-dlp 下载工作台',
    `  接口地址  http://${config.host}:${config.port}/api`,
    `  下载目录  ${store.state.settings.downloadDir}`,
    engine.ok && engine.engine
      ? `  yt-dlp    ${engine.engine.version}（${engine.engine.mode === 'python' ? 'Python 源码' : '可执行文件'}）`
      : `  yt-dlp    未就绪：${engine.error}`,
    engine.engine?.ffmpegPath
      ? `  ffmpeg    ${engine.engine.ffmpegVersion}`
      : '  ffmpeg    未检测到（B 站高清视频需要合并音视频）',
    config.serveWeb
      ? `  前端      http://${config.host}:${config.port}/`
      : '  前端      开发模式请另开终端运行 pnpm dev，或执行 pnpm build 后由后端托管',
    '',
  ];
  console.log(lines.join('\n'));

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`收到 ${signal}，正在退出…`);
    hub.close();
    store.flush();
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    app.log.error(error);
  });
  process.on('unhandledRejection', (reason) => {
    app.log.error(reason);
  });
}

void main();
