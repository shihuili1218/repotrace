import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import type { AssetReport } from '../shared/types';
import { api } from './api';
import { ReleaseCacheNote } from './ReleaseCacheNote';
import { DownloadComparison, DownloadDistribution } from './DownloadCharts';
const when = (at: number | null) =>
  at
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(at * 1000))
    : '尚未读取';
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${(value / 1024).toFixed(1)} KB`
      : value < 1024 ** 3
        ? `${(value / 1024 ** 2).toFixed(1)} MB`
        : `${(value / 1024 ** 3).toFixed(2)} GB`;
export function ReleaseAssets({
  repo,
  releaseId,
  onClose,
}: {
  repo: string;
  releaseId: number;
  onClose: () => void;
}) {
  const [report, setReport] = useState<AssetReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fence = useRef(0);
  const load = useCallback(async () => {
    const id = ++fence.current;
    setBusy(true);
    setError('');
    const path = `/repositories/${repo}/releases/${releaseId}/assets`;
    try {
      const saved = await api<AssetReport>(path);
      if (id !== fence.current) return;
      setReport(saved);
    } catch (e) {
      if (id === fence.current)
        setError(e instanceof Error ? e.message : '下载量读取失败，请稍后刷新。');
    } finally {
      if (id === fence.current) setBusy(false);
    }
  }, [repo, releaseId]);
  useEffect(() => {
    setReport(null);
    void load();
    return () => {
      fence.current++;
    };
  }, [load]);
  const known =
    report?.observedAt !== null &&
    (report?.assets.every((a) => a.download_count !== null) ?? false);
  const total = known
    ? report!.assets.reduce((sum, a) => sum + BigInt(a.download_count!), 0n)
    : null;
  return (
    <section className="panel asset-panel" aria-label="产物下载量">
      <div className="panel-header">
        <div>
          <h2>{report?.tag ?? 'Release'} 的产物下载量</h2>
          <p>当前累计值 · 与历史统计区间独立</p>
        </div>
        <div className="module-filters">
          <button className="button secondary" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} />
            刷新下载量
          </button>
          <button className="icon-button" aria-label="关闭产物下载量" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </div>
      <div className="asset-summary">
        <span>
          当前清单累计下载 <strong>{total === null ? '—' : total.toLocaleString()}</strong>
        </span>
        <small>
          读取时间：{when(report?.observedAt ?? null)}
          {report?.source === 'webhook'
            ? ' · Webhook 快照'
            : report?.source === 'github'
              ? ' · GitHub 公开接口'
              : ''}
        </small>
      </div>
      <ReleaseCacheNote cache={report?.cache} />
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
        </div>
      )}
      {!report ? (
        <p className="small-empty">正在读取产物…</p>
      ) : report.observedAt === null ? (
        <p className="small-empty">
          产物清单尚无缓存，已请求后台读取。稍后刷新可查看已完成的缓存。
        </p>
      ) : !report.assets.length ? (
        <p className="small-empty">该版本没有上传的产物。</p>
      ) : (
        <>
          <div className="download-chart-grid">
            <DownloadComparison
              label="产物累计下载量对比图"
              points={[...report.assets]
                .sort((a, b) => (b.download_count ?? -1) - (a.download_count ?? -1))
                .map((a) => ({
                  id: String(a.github_id),
                  label: a.name,
                  value: a.download_count === null ? null : String(a.download_count),
                }))}
            />
            <DownloadDistribution
              points={report.assets.map((a) => ({
                id: String(a.github_id),
                label: a.name,
                value: a.download_count === null ? null : String(a.download_count),
              }))}
            />
          </div>
          <div className="table-scroll">
            <table className="monitor-table asset-table">
              <thead>
                <tr>
                  <th>产物名称</th>
                  <th>大小</th>
                  <th>当前累计下载量</th>
                </tr>
              </thead>
              <tbody>
                {report.assets.map((asset) => (
                  <tr key={asset.github_id}>
                    <td>
                      {asset.download_url ? (
                        <a
                          className="record-title"
                          href={asset.download_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Download size={14} />
                          {asset.name}
                        </a>
                      ) : (
                        <strong>{asset.name}</strong>
                      )}
                      <small>
                        {asset.content_type}
                        {asset.state === 'open' ? ' · 处理中' : ''}
                      </small>
                    </td>
                    <td>{bytes(asset.size)}</td>
                    <td>
                      <strong>
                        {asset.download_count === null
                          ? '未知'
                          : asset.download_count.toLocaleString()}
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="table-note">
        每次读取返回缓存，并请求后台更新；更新后再次读取可见。图表按当前累计下载量展示。 GitHub
        自动生成的 Source code 压缩包没有下载量数据。
      </div>
    </section>
  );
}
