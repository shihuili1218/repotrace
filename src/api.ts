export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const readOnly = method === 'GET';
  const hasBody = !['GET', 'HEAD'].includes(method);
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), readOnly ? 10000 : 120000);
    try {
      const response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(options.body ?? {}) : undefined,
        signal: controller.signal,
      });
      if (response.status === 401 && !path.startsWith('/auth/'))
        window.dispatchEvent(new Event('session-expired'));
      // Read the body inside the timeout too: a connection can stall after headers arrive.
      const raw = await response.text();
      let data: T & { error?: string };
      try {
        data = JSON.parse(raw);
      } catch {
        throw new ApiError(
          response.status,
          response.ok
            ? '观测站返回了无效响应，请刷新页面后重试。'
            : `观测站服务响应异常（HTTP ${response.status}），请稍后重试。`,
        );
      }
      if (!response.ok)
        throw new ApiError(
          response.status,
          typeof data?.error === 'string' ? data.error : '请求失败，请重试。',
        );
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Only retry reads. A lost response does not mean a write was not applied.
      if (!readOnly || attempt === 2)
        throw new ApiError(
          controller.signal.aborted ? 408 : 0,
          readOnly
            ? controller.signal.aborted
              ? '连接观测站超时，请检查网络后重新连接。'
              : '无法连接观测站，请检查网络后重试。'
            : '连接中断或请求超时，无法确认操作结果。请刷新页面确认后再试。',
        );
    } finally {
      window.clearTimeout(timeout);
    }
    await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 350 : 900));
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
