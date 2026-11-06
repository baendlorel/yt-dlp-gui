export function formatBytes(value: number | undefined | null): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 || unit === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return '';
  const total = Math.round(seconds);
  if (total > 3600) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    return `约 ${hours} 小时 ${minutes} 分`;
  }
  if (total > 60) return `约 ${Math.floor(total / 60)} 分 ${total % 60} 秒`;
  return `约 ${total} 秒`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `今天 ${time}`;
  const day = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  return `${day} ${time}`;
}

export function pct(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function fileNameOf(path: string | undefined): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
