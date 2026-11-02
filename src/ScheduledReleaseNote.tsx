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
        {when ? `每小时更新 · 最近采集于 ${when}。` : '尚无采集数据，等待下一次每小时采集。'}
      </p>
    </div>
  );
}
