#!/usr/bin/env node
/**
 * 环境自检：node / yt-dlp / python / ffmpeg / 前端构建产物。
 * 用法：pnpm setup:check
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  /* 没有 .env */
}

const results = [];
const record = (level, label, detail) => results.push({ level, label, detail });

function which(cmd) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(finder, [cmd], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function run(file, args, env) {
  try {
    const result = spawnSync(file, args, {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      cwd: root,
      env: { ...process.env, ...env },
    });
    if (result.status !== 0) return null;
    return (result.stdout ?? '').trim();
  } catch {
    return null;
  }
}

// Node
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 19)) {
  record('ok', 'Node.js', process.versions.node);
} else {
  record('fail', 'Node.js', `${process.versions.node}（需要 ≥ 20.19）`);
}

// yt-dlp 源码
const sourceDir = path.resolve(root, process.env.YTDLP_DIR || 'yt-dlp');
const hasSource = fs.existsSync(path.join(sourceDir, 'yt_dlp', '__main__.py'));
record(hasSource ? 'ok' : 'warn', 'yt-dlp 源码', hasSource ? sourceDir : `未找到 ${sourceDir}`);

// Python + yt-dlp 模块
const pythonCandidates = [];
const envPython = process.env.YTDLP_PYTHON;
if (envPython) pythonCandidates.push({ file: envPython, args: [] });
for (const name of ['python', 'python3']) {
  const found = which(name);
  if (found) pythonCandidates.push({ file: found, args: [] });
}
const pyLauncher = which('py');
if (pyLauncher) pythonCandidates.push({ file: pyLauncher, args: ['-3'] });

let pythonOk = false;
for (const candidate of pythonCandidates) {
  const version = run(candidate.file, [...candidate.args, '-c', 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")']);
  if (!version) continue;
  const [major, minor] = version.split('.').map(Number);
  if ((major ?? 0) < 3 || ((major ?? 0) === 3 && (minor ?? 0) < 10)) continue;
  if (!hasSource) {
    record('ok', 'Python', `${version}（${candidate.file}）`);
    pythonOk = true;
    break;
  }
  const moduleVersion = run(
    candidate.file,
    [...candidate.args, '-m', 'yt_dlp', '--version'],
    {
      PYTHONPATH: `${sourceDir}${path.delimiter}${process.env.PYTHONPATH ?? ''}`,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  );
  if (moduleVersion) {
    record('ok', 'Python + yt-dlp', `${version} → yt-dlp ${moduleVersion.split(/\r?\n/).pop()}`);
    pythonOk = true;
    break;
  }
  record('warn', 'Python', `${version} 可用，但无法从源码启动 yt-dlp`);
}

// yt-dlp 可执行文件
const binaryCandidates = [
  process.env.YTDLP_PATH,
  path.join(root, 'tools', 'yt-dlp', 'yt-dlp.exe'),
  which('yt-dlp'),
].filter(Boolean);

let binaryOk = false;
for (const candidate of binaryCandidates) {
  if (!fs.existsSync(candidate)) continue;
  const version = run(candidate, ['--version']);
  if (version) {
    record('ok', 'yt-dlp 可执行文件', `${version.split(/\r?\n/).pop()}（${candidate}）`);
    binaryOk = true;
    break;
  }
}

if (!pythonOk && !binaryOk) {
  record('fail', '下载引擎', '未找到可用的 yt-dlp。请设置 YTDLP_PYTHON 或 YTDLP_PATH。');
}

// ffmpeg
const ffmpegCandidates = [
  process.env.FFMPEG_PATH,
  path.join(root, 'tools', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
  which('ffmpeg'),
].filter(Boolean);

let ffmpegOk = false;
for (const candidate of ffmpegCandidates) {
  if (!fs.existsSync(candidate)) continue;
  const output = run(candidate, ['-hide_banner', '-version']);
  if (output) {
    const match = output.match(/ffmpeg version\s+(\S+)/i);
    record('ok', 'ffmpeg', `${match?.[1] ?? 'unknown'}（${candidate}）`);
    ffmpegOk = true;
    break;
  }
}
if (!ffmpegOk) {
  record('fail', 'ffmpeg', '未找到。B 站高清需要合并音视频，请安装或放入 tools/ffmpeg/bin/。');
}

// 前端构建
const webIndex = path.join(root, 'web', 'dist', 'index.html');
if (fs.existsSync(webIndex)) {
  record('ok', '前端构建产物', path.dirname(webIndex));
} else {
  record('warn', '前端构建产物', '尚未构建；运行 pnpm build 后可由后端托管，或开发时用 pnpm dev。');
}

// 输出
const mark = { ok: '✓', warn: '!', fail: '✗' };
const color = { ok: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m' };
console.log('\nBiliFlow 环境自检\n');
for (const item of results) {
  console.log(`  ${color[item.level]}${mark[item.level]}\u001b[0m ${item.label.padEnd(18)} ${item.detail}`);
}

const failed = results.filter((item) => item.level === 'fail');
console.log('');
if (failed.length === 0) {
  console.log('  结论：可以启动。执行 pnpm dev 或 pnpm build && pnpm start。\n');
  process.exit(0);
}
console.log(`  结论：有 ${failed.length} 项阻塞，请按上面的提示修复。\n`);
process.exit(1);
