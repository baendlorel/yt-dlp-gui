import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { Settings } from '../types.js';

export interface Engine {
  /** binary：直接执行 yt-dlp 可执行文件；python：python -m yt_dlp */
  mode: 'binary' | 'python';
  file: string;
  baseArgs: string[];
  version: string;
  ytdlpDir: string;
  env: NodeJS.ProcessEnv;
  ffmpegPath: string | null;
  ffmpegVersion: string | null;
}

export interface EngineStatus {
  ok: boolean;
  engine?: Engine;
  error?: string;
  checkedAt: number;
}

interface Candidate {
  file: string;
  baseArgs: string[];
}

let cache: { key: string; status: EngineStatus } | null = null;

export function invalidateEngineCache(): void {
  cache = null;
}

function whichSync(cmd: string): string | null {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const result = spawnSync(finder, [cmd], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (result.status !== 0 || !result.stdout) return null;
    const first = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

function probe(candidate: Candidate, args: string[], env?: NodeJS.ProcessEnv): string | null {
  try {
    const result = spawnSync(candidate.file, [...candidate.baseArgs, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      env: { ...process.env, ...env },
    });
    if (result.status !== 0) return null;
    return (result.stdout ?? '').trim();
  } catch {
    return null;
  }
}

function binaryCandidate(raw: string): Candidate | null {
  const value = raw.trim();
  if (!value) return null;
  const resolved = fs.existsSync(value) ? value : whichSync(value);
  return resolved ? { file: resolved, baseArgs: [] } : null;
}

function pythonCandidates(settings: Settings): Candidate[] {
  const explicit = settings.pythonPath?.trim() || config.env.pythonPath;
  if (explicit) {
    const resolved = fs.existsSync(explicit) ? explicit : whichSync(explicit);
    return resolved ? [{ file: resolved, baseArgs: [] }] : [];
  }
  const names: Candidate[] = [
    { file: 'python', baseArgs: [] },
    { file: 'python3', baseArgs: [] },
    { file: 'py', baseArgs: ['-3'] },
  ];
  return names
    .map((candidate) => {
      const resolved = whichSync(candidate.file);
      return resolved ? { file: resolved, baseArgs: candidate.baseArgs } : null;
    })
    .filter((candidate): candidate is Candidate => Boolean(candidate));
}

function ffmpegCandidates(settings: Settings): Candidate[] {
  const values = [
    settings.ffmpegPath?.trim(),
    config.env.ffmpegPath,
    path.join(config.toolsDir, 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
  ].filter((value): value is string => Boolean(value));

  const candidates: Candidate[] = [];
  for (const value of values) {
    if (fs.existsSync(value)) candidates.push({ file: value, baseArgs: [] });
  }
  const fromPath = whichSync('ffmpeg');
  if (fromPath) candidates.push({ file: fromPath, baseArgs: [] });
  return candidates;
}

function detectFfmpeg(settings: Settings): { path: string | null; version: string | null } {
  for (const candidate of ffmpegCandidates(settings)) {
    const raw = probe(candidate, ['-hide_banner', '-version']);
    if (!raw) continue;
    const match = raw.match(/ffmpeg version\s+(\S+)/i);
    return { path: candidate.file, version: match?.[1] ?? 'unknown' };
  }
  return { path: null, version: null };
}

function detect(settings: Settings): EngineStatus {
  const checkedAt = Date.now();
  const ytdlpDir = config.ytdlpDir;
  const candidates: Array<{ candidate: Candidate; mode: 'binary' | 'python'; env: NodeJS.ProcessEnv }> = [];

  const binaryValues = [settings.ytdlpPath?.trim(), config.env.ytdlpPath]
    .filter((value): value is string => Boolean(value));
  binaryValues.push(path.join(config.toolsDir, 'yt-dlp', 'yt-dlp.exe'));
  for (const value of binaryValues) {
    const candidate = binaryCandidate(value);
    if (candidate) candidates.push({ candidate, mode: 'binary', env: {} });
  }
  const pathBinary = whichSync('yt-dlp');
  if (pathBinary) candidates.push({ candidate: { file: pathBinary, baseArgs: [] }, mode: 'binary', env: {} });

  if (fs.existsSync(path.join(ytdlpDir, 'yt_dlp', '__main__.py'))) {
    for (const candidate of pythonCandidates(settings)) {
      const version = probe(candidate, ['-c', 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")']);
      if (!version) continue;
      const [major, minor] = version.split('.').map(Number);
      if ((major ?? 0) < 3 || ((major ?? 0) === 3 && (minor ?? 0) < 10)) continue;
      candidates.push({
        candidate: { file: candidate.file, baseArgs: [...candidate.baseArgs, '-m', 'yt_dlp'] },
        mode: 'python',
        env: {
          PYTHONPATH: `${ytdlpDir}${path.delimiter}${process.env.PYTHONPATH ?? ''}`,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
      });
    }
  }

  let lastError = '未找到可用的 yt-dlp。';
  for (const item of candidates) {
    const raw = probe(item.candidate, ['--version'], item.env);
    if (!raw) {
      lastError =
        item.mode === 'python'
          ? '找到了 Python，但无法从 ./yt-dlp 源码启动 yt-dlp（缺少依赖或源码不完整）。'
          : 'yt-dlp 可执行文件无法运行。';
      continue;
    }
    const version = raw.split(/\r?\n/).pop()?.trim() || 'unknown';
    const ffmpeg = detectFfmpeg(settings);
    return {
      ok: true,
      checkedAt,
      engine: {
        mode: item.mode,
        file: item.candidate.file,
        baseArgs: item.candidate.baseArgs,
        version,
        ytdlpDir,
        env: item.env,
        ffmpegPath: ffmpeg.path,
        ffmpegVersion: ffmpeg.version,
      },
    };
  }

  if (!fs.existsSync(ytdlpDir)) {
    lastError = `未找到 yt-dlp：请把 yt-dlp 放到 ${ytdlpDir}，或在 .env 中设置 YTDLP_PATH。`;
  } else if (candidates.length === 0) {
    lastError =
      '未找到 Python 3.10+。请安装 Python，或在 .env 中设置 YTDLP_PYTHON，或直接指定 yt-dlp 可执行文件 YTDLP_PATH。';
  }
  return { ok: false, checkedAt, error: lastError };
}

export function getEngine(settings: Settings, force = false): EngineStatus {
  const key = JSON.stringify([
    settings.ytdlpPath,
    settings.pythonPath,
    settings.ffmpegPath,
    config.env.ytdlpPath,
    config.env.pythonPath,
    config.env.ffmpegPath,
  ]);
  if (!force && cache && cache.key === key && Date.now() - cache.status.checkedAt < 15000) {
    return cache.status;
  }
  const status = detect(settings);
  cache = { key, status };
  return status;
}

export function requireEngine(settings: Settings): Engine {
  const status = getEngine(settings);
  if (!status.ok || !status.engine) {
    throw new Error(status.error ?? 'yt-dlp 不可用');
  }
  return status.engine;
}
