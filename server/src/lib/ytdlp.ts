import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { config } from '../config.js';
import type { Engine } from './engine.js';

export interface StreamingResult {
  code: number | null;
  aborted: boolean;
  timedOut: boolean;
  stderrTail: string;
}

export interface CaptureResult extends StreamingResult {
  stdout: string;
}

interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

const MAX_CAPTURE = 32 * 1024 * 1024;
const MAX_TAIL = 64 * 1024;

export function buildEngineArgs(engine: Engine, args: string[]): { file: string; args: string[] } {
  return { file: engine.file, args: [...engine.baseArgs, ...args] };
}

export function spawnEngine(engine: Engine, args: string[], options: RunOptions = {}): ChildProcess {
  const plan = buildEngineArgs(engine, args);
  return spawn(plan.file, plan.args, {
    cwd: config.root,
    env: { ...process.env, ...engine.env, ...options.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      return;
    } catch {
      /* 退化为普通 kill */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* 进程可能已退出 */
  }
}

function wireLineSplitter(onLine: ((line: string) => void) | undefined) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return {
    push(chunk: Buffer) {
      buffer += decoder.write(chunk);
      const parts = buffer.split(/\r\n|\n|\r/);
      buffer = parts.pop() ?? '';
      if (onLine) {
        for (const line of parts) onLine(line);
      }
    },
    flush() {
      buffer += decoder.end();
      if (buffer && onLine) onLine(buffer);
      buffer = '';
    },
  };
}

/** 跑一个会输出大量文本的命令（典型是 -J 解析），收集 stdout */
export function runCapture(engine: Engine, args: string[], options: RunOptions = {}): Promise<CaptureResult> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ code: null, aborted: true, timedOut: false, stdout: '', stderrTail: '' });
      return;
    }

    let child: ChildProcess;
    try {
      child = spawnEngine(engine, args, options);
    } catch (error) {
      resolve({
        code: null,
        aborted: false,
        timedOut: false,
        stdout: '',
        stderrTail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let aborted = false;
    let timedOut = false;

    const stdoutDecoder = new StringDecoder('utf8');
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += stdoutDecoder.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > MAX_TAIL) stderr = stderr.slice(-MAX_TAIL);
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, options.timeoutMs)
      : null;

    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (code: number | null) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      stdout += stdoutDecoder.end();
      resolve({ code, aborted, timedOut, stdout, stderrTail: stderr });
    };

    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

/** 跑一个长任务（下载），逐行回调 stdout/stderr */
export function runStreaming(
  engine: Engine,
  args: string[],
  options: RunOptions = {},
): Promise<StreamingResult> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ code: null, aborted: true, timedOut: false, stderrTail: '' });
      return;
    }

    let child: ChildProcess;
    try {
      child = spawnEngine(engine, args, options);
    } catch (error) {
      resolve({
        code: null,
        aborted: false,
        timedOut: false,
        stderrTail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let stderr = '';
    let aborted = false;
    let timedOut = false;
    const stdoutLines = wireLineSplitter(options.onLine);
    const stderrLines = wireLineSplitter((line) => {
      stderr += `${line}\n`;
      if (stderr.length > MAX_TAIL) stderr = stderr.slice(-MAX_TAIL);
      options.onStderrLine?.(line);
    });

    child.stdout?.on('data', (chunk: Buffer) => stdoutLines.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrLines.push(chunk));

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, options.timeoutMs)
      : null;

    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (code: number | null) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      stdoutLines.flush();
      stderrLines.flush();
      resolve({ code, aborted, timedOut, stderrTail: stderr });
    };

    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
