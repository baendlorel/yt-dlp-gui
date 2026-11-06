import type { DownloadOptions, ExpandResult, MediaItem, Settings } from '../types.js';
import type { Engine } from '../lib/engine.js';

export interface ProviderContext {
  engine: Engine;
  settings: Settings;
  /** 本次任务在主页填写的 Cookie；优先于 settings.cookie */
  cookie?: string;
  /** 已写好的本次批次 Cookie 文件（B 站等需要 --cookies 的站点使用） */
  cookieFile?: string;
  /** 批次 ID，用于按批次惰性生成 Cookie 文件 */
  batchId?: string;
  signal?: AbortSignal;
}

/**
 * 站点适配器接口。
 *
 * 新增站点时：实现 match / normalize / expand / downloadArgs 四件事，
 * 然后在 registry 里注册即可；队列、批量、进度、持久化、前端无需改动。
 * 只依赖 yt-dlp 通用能力的站点可以直接继承 GenericProvider。
 */
export interface Provider {
  id: string;
  label: string;
  description: string;
  examples: string[];
  /** 数值越小越优先匹配 */
  priority: number;
  match(url: string): boolean;
  normalize(url: string, ctx: ProviderContext): Promise<string>;
  expand(url: string, ctx: ProviderContext): Promise<ExpandResult>;
  /** 返回 yt-dlp 参数（不含 python/可执行文件本身） */
  downloadArgs(item: MediaItem, options: DownloadOptions, ctx: ProviderContext): string[];
  /** 该站点下载文件的落盘目录 */
  outputDir(settings: Settings): string;
  /** 把 yt-dlp 的原始报错转成面向用户的中文提示 */
  friendlyError(stderr: string): string;
}
