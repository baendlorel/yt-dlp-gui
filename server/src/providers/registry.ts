import type { Settings } from '../types.js';
import type { Provider } from './types.js';
import { BilibiliProvider } from './bilibili.js';
import { YtDlpProvider } from './ytdlpProvider.js';

/** 兜底适配器：yt-dlp 支持而当前没有专门适配的站点（YouTube、X 等） */
export class GenericProvider extends YtDlpProvider {
  id = 'generic';
  label = '通用站点';
  description = '由 yt-dlp 支持的其它站点，自动兜底';
  examples = ['https://www.youtube.com/watch?v=...', 'https://vimeo.com/...'];
  priority = 1000;

  match(url: string): boolean {
    return /^https?:\/\//i.test(url.trim());
  }
}

export class ProviderRegistry {
  private readonly providers: Provider[];

  constructor(providers: Provider[]) {
    this.providers = [...providers].sort((a, b) => a.priority - b.priority);
  }

  list(): Provider[] {
    return this.providers;
  }

  get(id: string): Provider | undefined {
    return this.providers.find((provider) => provider.id === id);
  }

  /** 按优先级匹配，generic 永远兜底 */
  match(url: string): Provider {
    return this.providers.find((provider) => provider.match(url)) ?? this.generic();
  }

  private generic(): Provider {
    const fallback = this.providers.find((provider) => provider.id === 'generic');
    if (!fallback) throw new Error('未配置兜底适配器');
    return fallback;
  }

  outputDirFor(id: string, settings: Settings): string {
    const provider = this.get(id) ?? this.generic();
    return provider.outputDir(settings);
  }
}

export function createRegistry(): ProviderRegistry {
  return new ProviderRegistry([new BilibiliProvider(), new GenericProvider()]);
}
