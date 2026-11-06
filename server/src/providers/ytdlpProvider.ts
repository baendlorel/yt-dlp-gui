import fs from 'node:fs';
import path from 'node:path';
import { cookieHeader } from '../lib/cookies.js';
import type { DownloadOptions, ExpandResult, MediaItem, Settings } from '../types.js';
import type { Engine } from '../lib/engine.js';
import { runCapture } from '../lib/ytdlp.js';
import type { Provider, ProviderContext } from './types.js';

const PROGRESS_TEMPLATE =
  'download:PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|' +
  '%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|' +
  '%(progress.fragment_index)s|%(progress.fragment_count)s';

const FORMAT_TEMPLATE = '%(title).120B [%(id)s].%(ext)s';

interface RawEntry {
  id?: string;
  title?: string;
  fulltitle?: string;
  url?: string;
  webpage_url?: string;
  original_url?: string;
  uploader?: string;
  channel?: string;
  creator?: string;
  duration?: number | null;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
  playlist_index?: number;
  _type?: string;
  entries?: RawEntry[];
  playlist_title?: string;
  [key: string]: unknown;
}

const CODEC_FILTER: Record<string, string> = {
  h264: '[vcodec^=avc1]',
  hevc: '[vcodec^=hev1]',
  av1: '[vcodec^=av01]',
};

/**
 * 基于 yt-dlp 的通用适配器基类。
 * 子类通常只需要覆盖 match/normalize 与少量参数即可获得完整下载能力。
 */
export class YtDlpProvider implements Provider {
  id = 'generic';
  label = '通用站点';
  description = '由 yt-dlp 支持的任意站点，使用通用解析规则';
  examples = ['https://www.youtube.com/watch?v=...'];
  priority = 1000;

  match(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  async normalize(url: string, _ctx: ProviderContext): Promise<string> {
    return url.trim();
  }

  protected extraExpandArgs(ctx: ProviderContext): string[] {
    return this.cookieArgs(ctx);
  }

  protected extraDownloadArgs(item: MediaItem, _options: DownloadOptions, ctx: ProviderContext): string[] {
    return this.cookieArgs(ctx);
  }

  /**
   * 通用站点的 Cookie 通过请求头传给 yt-dlp。
   * yt-dlp 会把它限定在下载 URL 的域名下，避免发给无关站点。
   */
  protected cookieArgs(ctx: ProviderContext): string[] {
    const raw = ctx.cookie?.trim();
    if (!raw) return [];
    const header = cookieHeader(raw);
    return header ? ['--add-header', `Cookie:${header}`] : [];
  }

  protected subtitleLangs(): string {
    return 'zh-CN,zh-Hans,zh,en';
  }

  protected entryUrl(entry: RawEntry, fallback: string): string {
    const candidate = entry.webpage_url || entry.url || entry.original_url;
    return typeof candidate === 'string' && /^https?:\/\//i.test(candidate) ? candidate : fallback;
  }

  protected toItem(entry: RawEntry, parentUrl: string, index?: number, playlistTitle?: string): MediaItem {
    const thumb =
      entry.thumbnail ||
      (Array.isArray(entry.thumbnails) ? entry.thumbnails.find((t) => t?.url)?.url : undefined) ||
      undefined;
    return {
      url: this.entryUrl(entry, parentUrl),
      id: typeof entry.id === 'string' ? entry.id : undefined,
      title:
        (typeof entry.title === 'string' && entry.title.trim()) ||
        (typeof entry.fulltitle === 'string' && entry.fulltitle.trim()) ||
        (typeof entry.id === 'string' ? entry.id : undefined) ||
        '未命名媒体',
      uploader:
        (typeof entry.uploader === 'string' && entry.uploader) ||
        (typeof entry.channel === 'string' && entry.channel) ||
        (typeof entry.creator === 'string' && entry.creator) ||
        undefined,
      duration: typeof entry.duration === 'number' ? entry.duration : undefined,
      thumbnail: thumb,
      webpageUrl: typeof entry.webpage_url === 'string' ? entry.webpage_url : undefined,
      playlistTitle,
      playlistIndex: typeof entry.playlist_index === 'number' ? entry.playlist_index : index,
    };
  }

  async expand(url: string, ctx: ProviderContext): Promise<ExpandResult> {
    const max = Math.max(1, Math.min(500, ctx.settings.maxPlaylistItems));
    const result = await runCapture(
      ctx.engine,
      [
        '-J',
        '--flat-playlist',
        '--no-warnings',
        '--no-progress',
        '--playlist-end',
        String(max),
        ...this.extraExpandArgs(ctx),
        url,
      ],
      { signal: ctx.signal, timeoutMs: 180000 },
    );

    if (result.aborted) throw new Error('解析已取消');
    if (result.timedOut) throw new Error('解析超时（180 秒），链接可能包含过多条目');
    if (!result.stdout.trim()) {
      throw new Error(this.friendlyError(result.stderrTail) || '解析失败：没有返回数据');
    }

    let data: RawEntry | null;
    try {
      data = JSON.parse(result.stdout) as RawEntry | null;
    } catch {
      throw new Error(this.friendlyError(result.stderrTail) || '解析失败：yt-dlp 返回了无法识别的数据');
    }
    if (!data || typeof data !== 'object') {
      throw new Error(this.friendlyError(result.stderrTail) || '解析失败：视频不存在、已删除或需要登录');
    }

    const isPlaylist = data._type === 'playlist' || Array.isArray(data.entries);
    if (!isPlaylist) {
      return { items: [this.toItem(data, url)] };
    }

    const entries = (Array.isArray(data.entries) ? data.entries : []).filter(
      (entry): entry is RawEntry => Boolean(entry) && typeof entry === 'object',
    );
    const playlistTitle = typeof data.title === 'string' ? data.title : undefined;
    const items = entries.slice(0, max).map((entry, index) => this.toItem(entry, url, index, playlistTitle));
    if (items.length === 0) {
      throw new Error('链接解析结果为空（可能需要登录或该合集不可见）');
    }
    return { items, playlistTitle };
  }

  protected formatArgs(options: DownloadOptions): string[] {
    if (options.quality === 'audio') {
      const args = ['-f', 'ba/b'];
      if (options.audioFormat === 'mp3') {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      }
      return args;
    }

    const height = options.quality === 'max' ? 0 : Number(options.quality);
    const cap = height > 0 ? `[height<=${height}]` : '';
    const codec = CODEC_FILTER[options.codec] ?? '';
    const preferred = `bv*${cap}${codec}`;
    const fallback = `bv*${cap}`;
    const args = ['-f', `${preferred}+ba/${fallback}+ba/b`, '--merge-output-format', 'mp4'];
    return args;
  }

  outputDir(settings: Settings): string {
    const base = path.resolve(settings.downloadDir);
    const dir = settings.organizeByProvider ? path.join(base, this.id) : base;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  downloadArgs(item: MediaItem, options: DownloadOptions, ctx: ProviderContext): string[] {
    const dir = this.outputDir(ctx.settings);
    const args: string[] = [
      '--no-colors',
      '--newline',
      '--no-warnings',
      '--no-playlist',
      '--windows-filenames',
      '--no-mtime',
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      '--retry-sleep',
      '2',
      '--concurrent-fragments',
      String(Math.max(1, ctx.settings.fragmentConcurrency)),
      '--paths',
      `home:${dir}`,
      '--output',
      FORMAT_TEMPLATE,
      '--progress',
      '--progress-template',
      PROGRESS_TEMPLATE,
      '--print',
      'after_move:FILE|%(filepath)s',
      ...this.formatArgs(options),
    ];

    if (ctx.engine.ffmpegPath) {
      args.push('--ffmpeg-location', ctx.engine.ffmpegPath);
    }
    if (options.subtitles || options.danmaku) {
      const langs: string[] = [];
      if (options.subtitles) langs.push(this.subtitleLangs());
      if (options.danmaku) langs.push('danmaku');
      args.push('--write-subs', '--sub-langs', langs.join(','));
    }
    if (options.thumbnail) {
      args.push('--write-thumbnail');
    }
    if (options.metadata) {
      args.push('--write-info-json');
    }

    args.push(...this.extraDownloadArgs(item, options, ctx));
    args.push(item.url);
    return args;
  }

  /** 把 yt-dlp 的英文报错翻译成可操作的中文提示 */
  friendlyError(stderr: string): string {
    const text = stderr.toLowerCase();
    if (!text.trim()) return '';
    if (text.includes('ffmpeg') && (text.includes('not found') || text.includes('not installed'))) {
      return '未找到 ffmpeg：B 站高清视频需要合并音视频，请在设置中指定 ffmpeg 路径。';
    }
    if (text.includes('http error 403')) {
      return '请求被拒绝（403）：可能需要配置 B 站 SESSDATA 登录信息。';
    }
    if (text.includes('412') || text.includes('blocked by server')) {
      return 'B 站接口限流（412）：请稍后再试，或在设置中配置 SESSDATA 后重试。';
    }
    if (text.includes('private video') || text.includes('premium') || text.includes('大会员')) {
      return '该内容需要登录或大会员权限，请在设置中配置 SESSDATA。';
    }
    if (text.includes('login') || text.includes('cookies')) {
      return '需要登录信息：请在设置中配置 B 站 SESSDATA。';
    }
    if (text.includes('requested format is not available')) {
      return '该清晰度不可用（可能需要登录），请降低画质后重试。';
    }
    if (text.includes('http error 404') || text.includes('not found')) {
      return '视频不存在或已被删除（404）。';
    }
    if (text.includes('unable to download webpage') || text.includes('failed to resolve')) {
      return '无法访问该链接，请检查链接是否有效或网络是否可达。';
    }
    if (text.includes('video unavailable') || text.includes('not available')) {
      return '视频不可用（可能已删除、地区限制或需要登录）。';
    }
    const lines = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[download]') && !line.startsWith('PROGRESS'));
    return lines
      .slice(-3)
      .join(' ')
      .replace(/^ERROR:\s*/i, '')
      .slice(0, 500);
  }
}
