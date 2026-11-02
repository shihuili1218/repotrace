import type { DownloadSummary } from '../shared/types';

export function ScheduledReleaseNote({ cache }: { cache?: DownloadSummary['cache'] }) {
  if (!cache) return null;
  const when = cache.updatedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(cache.updatedAt * 1000))
    : null;
  return (
    <div className="release-cache-note">
      <p className="field-note" role="status">
        {when
          ? `每次采集成功后，间隔一小时再采集 · 最近采集于 ${when}。`
          : '尚无采集数据，等待自动采集。'}
      </p>
    </div>
  );
}
