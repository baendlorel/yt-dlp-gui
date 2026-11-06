/** 画质档位。audio 表示只要音频。 */
export type QualityOption = 'max' | '2160' | '1440' | '1080' | '720' | '480' | '360' | 'audio';
export type CodecPreference = 'auto' | 'h264' | 'hevc' | 'av1';
export type AudioFormat = 'm4a' | 'mp3';

export interface DownloadOptions {
  quality: QualityOption;
  codec: CodecPreference;
  audioFormat: AudioFormat;
  /** 下载 CC / AI 字幕（B 站字幕需要登录） */
  subtitles: boolean;
  /** 下载弹幕 XML（B 站无需登录） */
  danmaku: boolean;
  /** 同时保存封面 */
  thumbnail: boolean;
  /** 同时保存 .info.json 元数据 */
  metadata: boolean;
  /** 是否把合集 / 分 P / 收藏夹展开成多条任务 */
  expandPlaylist: boolean;
  /** 单个链接最多展开多少条 */
  maxItems: number;
}

export type TaskStatus =
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface TaskProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  eta: number | null;
  /** DASH 音视频是分段下载的，记录当前是第几段（视频=1，音频=2） */
  stream?: number;
}

export interface DownloadTask {
  id: string;
  batchId: string;
  providerId: string;
  providerLabel: string;
  url: string;
  /** 站点侧的媒体 ID（如 BV 号），用于定位落盘文件 */
  mediaId?: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  webpageUrl?: string;
  playlistTitle?: string;
  playlistIndex?: number;
  status: TaskStatus;
  progress: TaskProgress;
  filePath?: string;
  error?: string;
  errorDetail?: string;
  logTail?: string;
  options: DownloadOptions;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  attempt: number;
}

export interface BatchError {
  input: string;
  message: string;
}

export interface DownloadBatch {
  id: string;
  createdAt: number;
  inputs: string[];
  options: DownloadOptions;
  taskIds: string[];
  errors: BatchError[];
  /** 链接解析中（展开合集等） */
  resolving: boolean;
  canceled: boolean;
}

export interface Settings {
  downloadDir: string;
  concurrency: number;
  fragmentConcurrency: number;
  maxPlaylistItems: number;
  /** B 站 SESSDATA 或完整 Cookie 字符串 */
  cookie: string;
  ffmpegPath: string;
  ytdlpPath: string;
  pythonPath: string;
  organizeByProvider: boolean;
}

export type PublicSettings = Omit<Settings, 'cookie'> & {
  hasCookie: boolean;
  cookiePreview: string;
};

export interface AppState {
  version: 1;
  tasks: DownloadTask[];
  batches: DownloadBatch[];
  settings: Settings;
}

export interface MediaItem {
  url: string;
  id?: string;
  title?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  webpageUrl?: string;
  playlistTitle?: string;
  playlistIndex?: number;
}

export interface ExpandResult {
  items: MediaItem[];
  playlistTitle?: string;
}

export function defaultOptions(maxItems = 300): DownloadOptions {
  return {
    quality: 'max',
    codec: 'h264',
    audioFormat: 'm4a',
    subtitles: false,
    danmaku: false,
    thumbnail: false,
    metadata: false,
    expandPlaylist: true,
    maxItems,
  };
}

export function normalizeOptions(input: unknown, maxItemsFallback = 300): DownloadOptions {
  const raw = (input ?? {}) as Partial<DownloadOptions>;
  const base = defaultOptions(maxItemsFallback);
  const qualities: QualityOption[] = ['max', '2160', '1440', '1080', '720', '480', '360', 'audio'];
  const codecs: CodecPreference[] = ['auto', 'h264', 'hevc', 'av1'];
  const audioFormats: AudioFormat[] = ['m4a', 'mp3'];
  return {
    quality: qualities.includes(raw.quality as QualityOption) ? (raw.quality as QualityOption) : base.quality,
    codec: codecs.includes(raw.codec as CodecPreference) ? (raw.codec as CodecPreference) : base.codec,
    audioFormat: audioFormats.includes(raw.audioFormat as AudioFormat)
      ? (raw.audioFormat as AudioFormat)
      : base.audioFormat,
    subtitles: Boolean(raw.subtitles),
    danmaku: Boolean(raw.danmaku),
    thumbnail: Boolean(raw.thumbnail),
    metadata: Boolean(raw.metadata),
    expandPlaylist: raw.expandPlaylist !== false,
    maxItems: clampInt(raw.maxItems, 1, 500, maxItemsFallback),
  };
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
