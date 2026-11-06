async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      // 只有带 body 的请求才设置 Content-Type；DELETE/GET 空 body 会被 Fastify 判为 400
      ...(init?.body !== undefined && init?.body !== null ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

export const api = {
  state: () => request<import('./types').StateResponse>('/api/state'),

  system: () => request<import('./types').SystemInfo>('/api/system'),

  saveSettings: (patch: Record<string, unknown>) =>
    request<{ settings: import('./types').PublicSettings; system: import('./types').SystemInfo }>(
      '/api/settings',
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      },
    ),

  createBatch: (body: {
    urls?: string[];
    items?: import('./types').MediaItem[];
    options?: import('./types').DownloadOptions;
    cookie?: string;
  }) =>
    request<{ batch: import('./types').Batch }>('/api/batches', json(body)),

  cancelBatch: (id: string) =>
    request<{ batch: import('./types').Batch }>(`/api/batches/${encodeURIComponent(id)}/cancel`, json({})),

  retryFailed: (id: string) =>
    request<{ count: number }>(`/api/batches/${encodeURIComponent(id)}/retry-failed`, json({})),

  deleteBatch: (id: string) =>
    request<{ ok: boolean }>(`/api/batches/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  preview: (urls: string[], limit = 300, cookie?: string) =>
    request<{ groups: import('./types').PreviewGroup[] }>(
      '/api/resolve',
      json({ urls, limit, ...(cookie?.trim() ? { cookie } : {}) }),
    ),

  cancelTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}/cancel`, json({})),

  retryTask: (id: string) =>
    request<{ task: import('./types').Task }>(`/api/tasks/${encodeURIComponent(id)}/retry`, json({})),

  revealTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}/reveal`, json({})),

  deleteTask: (id: string) =>
    request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  clearFinished: () => request<{ removed: number }>('/api/tasks', { method: 'DELETE' }),
};
