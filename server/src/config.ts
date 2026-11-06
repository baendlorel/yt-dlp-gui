import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/src 与 server/dist 都在项目根下一层，向上两级即仓库根目录 */
export const ROOT = path.resolve(here, '..', '..');

// 支持 .env（Node 20.12+），已存在的环境变量优先
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* 没有 .env 时忽略 */
}

function fromRoot(value: string | undefined, fallback: string): string {
  return path.resolve(ROOT, value?.trim() || fallback);
}

export const config = {
  root: ROOT,
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST?.trim() || '127.0.0.1',
  downloadDir: fromRoot(process.env.DOWNLOAD_DIR, 'downloads'),
  dataDir: fromRoot(process.env.DATA_DIR, 'data'),
  ytdlpDir: fromRoot(process.env.YTDLP_DIR, 'yt-dlp'),
  toolsDir: path.join(ROOT, 'tools'),
  webDist: path.join(ROOT, 'web', 'dist'),
  env: {
    ytdlpPath: process.env.YTDLP_PATH?.trim() || '',
    pythonPath: process.env.YTDLP_PYTHON?.trim() || '',
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || '',
  },
  /** 前端构建产物存在时由后端直接托管（生产模式） */
  serveWeb: fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html')),
};

export function ensureDirs(): void {
  for (const dir of [config.dataDir, config.downloadDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
