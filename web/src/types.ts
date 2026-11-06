export type QualityOption = 'max' | '2160' | '1440' | '1080' | '720' | '480' | '360' | 'audio';
export type CodecPreference = 'auto' | 'h264' | 'hevc' | 'av1';
export type AudioFormat = 'm4a' | 'mp3';
export type TaskStatus = 'queued' | 'downloading' | 'processing' | 'completed' | 'failed' | 'canceled';

export interface DownloadOptions {
  quality: QualityOption;
  codec: CodecPreference;
  audioFormat: AudioFormat;
  subtitles: boolean;
  danmaku: boolean;
  thumbnail: boolean;
  metadata: boolean;
  expandPlaylist: boolean;
  maxItems: number;
}

export interface TaskProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
  eta: number | null;
  stream?: number;
}

export interface Task {
  id: string;
  batchId: string;
  providerId: string;
  providerLabel: string;
  url: string;
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

export interface Batch {
  id: string;
  createdAt: number;
  inputs: string[];
  options: DownloadOptions;
  taskIds: string[];
  errors: BatchError[];
  resolving: boolean;
  canceled: boolean;
}

export interface PublicSettings {
  downloadDir: string;
  concurrency: number;
  fragmentConcurrency: number;
  maxPlaylistItems: number;
  ffmpegPath: string;
  ytdlpPath: string;
  pythonPath: string;
  organizeByProvider: boolean;
  hasCookie: boolean;
  cookiePreview: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  examples: string[];
  priority?: number;
}

export interface SystemInfo {
  ok: boolean;
  error: string | null;
  ytdlp: { mode: 'binary' | 'python'; version: string; file: string; sourceDir: string } | null;
  ffmpeg: { path: string; version: string } | null;
  providers: ProviderInfo[];
  queue: { running: number; queued: number; concurrency: number };
  dirs: {
    downloadDir: string;
    dataDir: string;
    ytdlpDir: string;
    webDist: string;
    webBuilt: boolean;
  };
  runtime: { node: string; platform: string; arch: string; appVersion: string };
}

export interface StateResponse {
  tasks: Task[];
  batches: Batch[];
  settings: PublicSettings;
  queue: { running: number; queued: number; concurrency: number };
  serverTime: number;
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

export interface PreviewGroup {
  input: string;
  providerId: string;
  providerLabel: string;
  playlistTitle?: string;
  items: MediaItem[];
  truncated?: boolean;
  error?: string;
}
