import type { DownloadOptions, ExpandResult, MediaItem, Settings } from '../types.js';
import { cookieHeader, ensureCookieFile, writeBatchCookieFile } from '../lib/cookies.js';
import { mapLimit } from '../lib/util.js';
import type { ProviderContext } from './types.js';
import { YtDlpProvider } from './ytdlpProvider.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 常见分享链接附带的追踪参数，统一丢弃，避免同一视频生成不同 URL */
const DROP_PARAMS = new Set([
  'spm_id_from',
  'vd_source',
  'from_source',
  'from_spmid',
  'from',
  'share_source',
  'share_medium',
  'share_plat',
  'share_tag',
  'share_session_id',
  'share_times',
  'share_id',
  'bb_unique_id',
  'unique_k',
  'timestamp',
  't',
  'up_id',
  'bsource',
  'buvid',
  'night',
  'is_story_h5',
  'launch_id',
  'plat_id',
  'seo_source',
  'spmid',
  'msource',
  'csource',
  'business_source',
  'auto_play',
  'danmaku',
  'player_width',
  'player_height',
  'url_from',
  'track_id',
  'trackid',
]);

const KEEP_PARAMS = new Set(['p', 'bvid', 'aid', 'fid', 'sid', 'oid', 'type', 'page']);

/**
 * 哔哩哔哩适配器。
 *
 * 这里承接从 yt-dlp/yt_dlp/extractor/bilibili.py 中抽出来的“站点规则”：
 *  - 链接形态：BV/av、b23.tv 短链、番剧 ep/ss、课程、收藏夹、UP 主合集/系列、直播
 *  - 鉴权：SESSDATA（1080P+ / 大会员 / 私密收藏夹）
 *  - 清晰度：B 站 qn 档位映射为按 height 过滤，交给 yt-dlp 选择实际格式
 *  - 字幕：zh-CN / zh-Hans / ai-zh（B 站 AI 字幕）
 * 具体取流（WBI 签名、DASH 解析）由 yt-dlp 完成，前端只关心统一的任务模型。
 */
export class BilibiliProvider extends YtDlpProvider {
  id = 'bilibili';
  label = '哔哩哔哩';
  description = '视频、番剧、课程、收藏夹、UP 主合集、直播';
  examples = [
    'https://www.bilibili.com/video/BV1GJ411x7h7',
    'https://b23.tv/xxxxxxx',
    'https://space.bilibili.com/2/favlist?fid=...',
    'https://www.bilibili.com/bangumi/play/ss12345',
  ];
  priority = 10;

  private static readonly ID_ONLY = /^(?:BV[0-9A-Za-z]{10}|av\d+)$/i;
  private static readonly SHORT_HOST = /^(?:b23\.tv|bili2233\.cn)$/i;

  match(url: string): boolean {
    const value = url.trim();
    if (BilibiliProvider.ID_ONLY.test(value)) return true;
    const host = hostOf(value);
    if (!host) return false;
    return host === 'bilibili.com' || host.endsWith('.bilibili.com') || BilibiliProvider.SHORT_HOST.test(host);
  }

  async normalize(url: string, ctx: ProviderContext): Promise<string> {
    let value = url.trim();
    if (!value) throw new Error('链接为空');

    if (BilibiliProvider.ID_ONLY.test(value)) {
      value = `https://www.bilibili.com/video/${value}`;
    }
    if (/^(?:[\w-]+\.)+[\w-]+\//.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      value = `https://${value}`;
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('无法识别的 B 站链接');
    }

    if (BilibiliProvider.SHORT_HOST.test(parsed.hostname)) {
      const resolved = await this.resolveShortLink(parsed.toString(), ctx.signal);
      try {
        parsed = new URL(resolved);
      } catch {
        throw new Error('短链接解析失败，请直接粘贴视频页面的完整链接');
      }
      if (BilibiliProvider.SHORT_HOST.test(parsed.hostname)) {
        throw new Error('短链接解析失败，请直接粘贴视频页面的完整链接');
      }
    }

    if (parsed.hostname.toLowerCase() === 'm.bilibili.com') {
      parsed.hostname = 'www.bilibili.com';
    }
    if (parsed.hostname.toLowerCase() === 'bilibili.com') {
      parsed.hostname = 'www.bilibili.com';
    }

    parsed.protocol = 'https:';
    parsed.hash = '';

    const kept = new URLSearchParams();
    for (const [key, val] of parsed.searchParams) {
      if (KEEP_PARAMS.has(key)) kept.append(key, val);
      else if (!DROP_PARAMS.has(key)) kept.append(key, val);
    }
    const query = kept.toString();
    parsed.search = query ? `?${query}` : '';

    return parsed.toString();
  }

  /**
   * yt-dlp 的 --flat-playlist 对 B 站只返回 URL/ID，不带标题。
   * 这里补一层 view 接口，把标题、UP 主、时长、封面补全（每个稿件一次请求）。
   */
  override async expand(url: string, ctx: ProviderContext): Promise<ExpandResult> {
    const result = await super.expand(url, ctx);
    await this.enrichItems(result.items, ctx, result.playlistTitle);
    return result;
  }

  private async enrichItems(
    items: MediaItem[],
    ctx: ProviderContext,
    playlistTitle?: string,
  ): Promise<void> {
    const missing = (item: MediaItem): boolean =>
      !item.title || item.title === '未命名媒体' || (Boolean(item.id) && item.title === item.id);

    if (!items.some(missing)) return;

    const cache = new Map<string, ViewData | null>();
    await mapLimit(items, 4, async (item) => {
      if (!missing(item)) return;
      const bvid = extractBvid(item.url) ?? extractBvid(item.id ?? '');
      if (!bvid) {
        item.title = item.id ?? item.url;
        return;
      }
      if (!cache.has(bvid)) {
        cache.set(bvid, await this.fetchView(bvid, ctx));
      }
      const view = cache.get(bvid);
      if (!view) {
        item.title = fallbackTitle(item, playlistTitle);
        return;
      }
      const baseTitle = view.title || playlistTitle || bvid;
      const p = pageOf(item.url);
      const page = p > 0 ? view.pages?.find((entry) => entry.page === p) : undefined;
      if (page) {
        item.title = `${baseTitle} p${String(page.page).padStart(2, '0')} ${page.part}`;
        item.id = `${bvid}_p${page.page}`;
        item.duration = page.duration;
      } else {
        item.title = baseTitle;
        item.id = view.bvid ?? bvid;
        item.duration = view.duration;
      }
      item.uploader = item.uploader ?? view.owner?.name;
      item.thumbnail = item.thumbnail ?? view.pic;
      item.webpageUrl = item.webpageUrl ?? `https://www.bilibili.com/video/${bvid}`;
    });
  }

  private async fetchView(bvid: string, ctx: ProviderContext): Promise<ViewData | null> {
    const timeout = AbortSignal.timeout(8000);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    try {
      const cookie = cookieHeader(ctx.cookie?.trim() || ctx.settings.cookie);
      const response = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
        {
          signal,
          headers: {
            'User-Agent': UA,
            Referer: 'https://www.bilibili.com/',
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
      );
      if (!response.ok) return null;
      const json = (await response.json()) as { code?: number; data?: ViewData };
      if (json.code !== 0 || !json.data) return null;
      return json.data;
    } catch {
      return null;
    }
  }

  /** 短链只做一次跟随跳转，拿不到就交给上层报错 */
  private async resolveShortLink(url: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(12000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: combined,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      const finalUrl = response.url;
      try {
        await response.body?.cancel();
      } catch {
        /* ignore */
      }
      return finalUrl || url;
    } catch (error) {
      if (signal?.aborted) throw new Error('解析已取消');
      throw new Error(
        `短链接展开失败（${error instanceof Error ? error.message : String(error)}），请直接粘贴视频页面的完整链接`,
      );
    }
  }

  protected extraExpandArgs(ctx: ProviderContext): string[] {
    return this.authArgs(ctx);
  }

  protected extraDownloadArgs(
    _item: MediaItem,
    _options: DownloadOptions,
    ctx: ProviderContext,
  ): string[] {
    return this.authArgs(ctx);
  }

  protected override subtitleLangs(): string {
    return 'zh-CN,zh-Hans,zh-Hant,zh,ai-zh,ai-en,en,en-US';
  }

  protected override entryUrl(
    entry: { id?: string; url?: string; webpage_url?: string; original_url?: string },
    fallback: string,
  ): string {
    const candidate = entry.webpage_url || entry.url || entry.original_url;
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
    const id = typeof entry.id === 'string' ? entry.id : '';
    const bv = id.match(/^(BV[0-9A-Za-z]{10})(?:_p(\d+))?$/);
    if (bv?.[1]) return `https://www.bilibili.com/video/${bv[1]}${bv[2] ? `?p=${bv[2]}` : ''}`;
    const av = id.match(/^av(\d+)(?:_p(\d+))?$/i);
    if (av?.[1]) return `https://www.bilibili.com/video/av${av[1]}${av[2] ? `?p=${av[2]}` : ''}`;
    return fallback;
  }

  private authArgs(ctx: ProviderContext): string[] {
    const args: string[] = ['--add-header', 'Referer:https://www.bilibili.com/'];
    const batchCookie = ctx.cookie?.trim();
    let cookieFile = ctx.cookieFile;
    if (!cookieFile && batchCookie && ctx.batchId) {
      cookieFile = writeBatchCookieFile(batchCookie, ctx.batchId) ?? undefined;
    }
    if (!cookieFile) {
      cookieFile = ensureCookieFile(batchCookie || ctx.settings.cookie) ?? undefined;
    }
    if (cookieFile) args.push('--cookies', cookieFile);
    return args;
  }

  outputDir(settings: Settings): string {
    return super.outputDir(settings);
  }
}

interface ViewPage {
  page: number;
  part: string;
  duration?: number;
}

interface ViewData {
  bvid?: string;
  title?: string;
  pic?: string;
  duration?: number;
  owner?: { name?: string };
  pages?: ViewPage[];
}

function extractBvid(value: string): string | null {
  const match = value.match(/(BV[0-9A-Za-z]{10})/);
  return match?.[1] ?? null;
}

function pageOf(url: string): number {
  try {
    const page = Number(new URL(url).searchParams.get('p'));
    return Number.isFinite(page) && page > 0 ? page : 0;
  } catch {
    return 0;
  }
}

function fallbackTitle(item: MediaItem, playlistTitle?: string): string {
  const page = pageOf(item.url);
  if (page > 0) return `${playlistTitle ?? '合集'} P${page}`;
  return item.id ?? item.url;
}

function hostOf(value: string): string | null {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}
