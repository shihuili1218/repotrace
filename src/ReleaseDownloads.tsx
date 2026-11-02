import { useEffect, useRef, useState } from 'react';
import type { DownloadSummary } from '../shared/types';
import { api } from './api';
import { ScheduledReleaseNote } from './ScheduledReleaseNote';
import { DownloadGrowth, downloadNumber } from './DownloadCharts';

export function ReleaseDownloads({
  repo,
  rangeQuery,
  cache,
}: {
  repo: string;
  rangeQuery: string;
  cache: DownloadSummary['cache'];
}) {
  const [data, setData] = useState<DownloadSummary | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const fence = useRef(0);
  useEffect(() => {
    const id = ++fence.current;
    setData(null);
    setError('');
    void api<DownloadSummary>(`/repositories/${repo}/releases/downloads?${rangeQuery}`)
      .then((next) => {
        if (id === fence.current) setData(next);
      })
      .catch((error: unknown) => {
        if (id === fence.current)
          setError(error instanceof Error ? error.message : '下载量读取失败。');
      });
    return () => {
      fence.current++;
    };
  }, [repo, rangeQuery, cache.updatedAt, cache.error, retry]);
  return (
    <section className="panel" aria-label="项目下载量">
      <div className="panel-header">
        <div>
          <h2>项目下载量</h2>
          <p>GitHub 各产物下载量汇总 · 最近一次采集的累计值</p>
        </div>
      </div>
      <div className="module-metrics pair">
        <article className="module-metric">
          <span>所有版本下载量</span>
          <strong>{downloadNumber(data?.total)}</strong>
          <small>Total Downloads</small>
        </article>
        <article className="module-metric">
          <span>最新正式版下载量</span>
          <strong>{downloadNumber(data?.latest)}</strong>
          <small>Latest Downloads</small>
        </article>
      </div>
      <ScheduledReleaseNote cache={data?.cache} />
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setRetry((value) => value + 1)}>重试</button>
        </div>
      )}
      {data ? (
        <DownloadGrowth history={data.history} />
      ) : (
        !error && (
          <p className="small-empty" role="status">
            正在读取下载量…
          </p>
        )
      )}
    </section>
  );
}
