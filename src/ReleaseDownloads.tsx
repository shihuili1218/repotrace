import { useEffect, useId, useRef, useState } from 'react';
import type { DownloadSummary } from '../shared/types';
import { api } from './api';
import { ScheduledReleaseNote } from './ScheduledReleaseNote';
import { DownloadGrowth, downloadNumber } from './DownloadCharts';

const releaseDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function VersionDownloads({ releases }: { releases: DownloadSummary['releases'] }) {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const listId = useId();
  const ranked = releases
    .map((release) => ({
      ...release,
      count: /^\d+$/.test(release.downloads) ? BigInt(release.downloads) : null,
    }))
    .sort((a, b) => {
      if (a.count !== b.count) {
        if (a.count === null) return 1;
        if (b.count === null) return -1;
        return a.count > b.count ? -1 : 1;
      }
      return b.publishedAt - a.publishedAt || b.id - a.id;
    });
  const total = ranked.every((release) => release.count !== null)
    ? ranked.reduce((sum, release) => sum + release.count!, 0n)
    : null;
  const visible = expanded ? ranked : ranked.slice(0, 5);

  return (
    <section className="version-downloads" aria-labelledby={headingId}>
      <div className="version-downloads-heading">
        <div>
          <h3 id={headingId}>版本下载排行</h3>
          <p>最近一次采集的各版本累计下载量与占比 · 与所选时间区间独立</p>
        </div>
        <span className="version-downloads-count">{releases.length.toLocaleString()} 个版本</span>
      </div>
      {ranked.length ? (
        <ol className="version-download-list" id={listId}>
          {visible.map((release, index) => {
            const proportion =
              total !== null && total > 0n && release.count !== null
                ? (release.count * 1000n) / total
                : null;
            const share =
              proportion === null
                ? '—'
                : proportion === 0n && release.count! > 0n
                  ? '<0.1%'
                  : `${proportion / 10n}${proportion % 10n ? `.${proportion % 10n}` : ''}%`;
            return (
              <li className="version-download-row" key={release.id}>
                <span className="version-download-rank" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="version-download-detail">
                  <div className="version-download-label">
                    <strong>{release.tag}</strong>
                    {release.prerelease && <span className="version-download-kind">预发布</span>}
                    <time dateTime={new Date(release.publishedAt * 1000).toISOString()}>
                      {releaseDate.format(new Date(release.publishedAt * 1000))}
                    </time>
                  </div>
                  {release.name && release.name !== release.tag && (
                    <span className="version-download-name">{release.name}</span>
                  )}
                  <svg
                    className="version-download-track"
                    viewBox="0 0 1000 4"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <rect className="version-download-rail" width="1000" height="4" rx="2" />
                    <rect
                      className="version-download-fill"
                      width={Number(proportion ?? 0n)}
                      height="4"
                      rx="2"
                    />
                  </svg>
                </div>
                <div className="version-download-value">
                  <strong>{downloadNumber(release.downloads)}</strong>
                  <span aria-label={`占全部版本下载量 ${share}`}>{share}</span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="small-empty">暂无已采集的公开版本</p>
      )}
      {ranked.length > 5 && (
        <button
          className="text-button version-download-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起排行' : `查看全部 ${ranked.length.toLocaleString()} 个版本`}
        </button>
      )}
    </section>
  );
}

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
  }, [repo, rangeQuery, cache.updatedAt, retry]);
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
        <>
          <DownloadGrowth history={data.history} />
          <VersionDownloads key={repo} releases={data.releases} />
        </>
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
