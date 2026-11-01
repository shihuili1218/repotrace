import type { ReleaseCacheState } from '../shared/types';
const when = (at: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(at * 1000));
export function ReleaseCacheNote({ cache }: { cache?: ReleaseCacheState | null }) {
  if (!cache) return null;
  return (
    <div className="release-cache-note">
      <p className="field-note" role="status">
        {cache.updatedAt ? `缓存更新于 ${when(cache.updatedAt)}。` : '缓存尚未建立。'}
        {cache.refreshRequested
          ? ' 已请求后台刷新，再次读取可查看更新。'
          : cache.retryAt
            ? ` ${when(cache.retryAt)} 后访问时重试刷新。`
            : ''}
      </p>
      {cache.error && (
        <div className="error-banner" role="alert">
          <span>
            {cache.error}
            {cache.updatedAt ? ' 当前展示上次成功读取的缓存。' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
