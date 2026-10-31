export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.method ? { 'Content-Type': 'application/json' } : undefined,
    body: options.method ? JSON.stringify(options.body ?? {}) : undefined,
  });
  const data = (await response
    .json()
    .catch(() => ({ error: '服务响应异常，请稍后重试。' }))) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.error ?? '请求失败，请重试。');
  }
  return data as T;
}
