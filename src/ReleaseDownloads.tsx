import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DownloadSummary } from '../shared/types';
import { api } from './api';
import { ReleaseCacheNote } from './ReleaseCacheNote';
import { DownloadComparison, downloadNumber } from './DownloadCharts';
export function ReleaseDownloads({ repo }: { repo: string }) {
  const [data, setData] = useState<DownloadSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<'downloads' | 'published'>('downloads');
  const fence = useRef(0);
  const read = useCallback(async () => {
    const id = ++fence.current;
    setBusy(true);
    setError('');
    try {
      const next = await api<DownloadSummary>(`/repositories/${repo}/releases/downloads`);
      if (id === fence.current) setData(next);
    } catch (error) {
      if (id === fence.current)
        setError(error instanceof Error ? error.message : '下载量缓存读取失败。');
    } finally {
      if (id === fence.current) setBusy(false);
    }
  }, [repo]);
  useEffect(() => {
    setData(null);
    void read();
    return () => {
      fence.current++;
    };
  }, [read]);
  return (
    <section className="panel" aria-label="项目下载量">
      <div className="panel-header">
        <div>
          <h2>项目下载量</h2>
          <p>GitHub 各产物下载量汇总 · 当前累计值</p>
        </div>
        <button className="button secondary" disabled={busy} onClick={() => void read()}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
          读取下载量缓存
        </button>
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
      <div className="download-chart-toolbar">
        <span>各版本累计下载量</span>
        <select
          aria-label="下载量图表排序"
          value={sort}
          onChange={(e) => setSort(e.target.value as 'downloads' | 'published')}
        >
          <option value="downloads">按下载量排序</option>
          <option value="published">按发布时间排序</option>
        </select>
      </div>
      <DownloadComparison
        label="各版本累计下载量对比图"
        limit={10}
        points={[...(data?.releases ?? [])]
          .sort((a, b) =>
            sort === 'published'
              ? b.publishedAt - a.publishedAt
              : BigInt(a.downloads) === BigInt(b.downloads)
                ? b.publishedAt - a.publishedAt
                : BigInt(a.downloads) > BigInt(b.downloads)
                  ? -1
                  : 1,
          )
          .map((r) => ({
            id: String(r.id),
            label: r.tag + (r.prerelease ? '（预发布）' : ''),
            value: r.downloads,
          }))}
      />
      <ReleaseCacheNote cache={data?.cache} />
      {error && (
        <p className="field-note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
