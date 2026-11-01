import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderGit2, RefreshCw } from 'lucide-react';
import type { Dashboard, RepoSummary, ReleaseBoundary, ReleaseCacheState } from '../shared/types';
import { api } from './api';
import { Monitoring } from './Monitoring';
import { ReleaseCacheNote } from './ReleaseCacheNote';
const when = (at: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(at * 1000));
export function ProjectData({
  repositories,
  projectId,
  onProjectChange,
}: {
  repositories: RepoSummary[];
  projectId: string;
  onProjectChange: (value: string) => void;
}) {
  const [mode, setMode] = useState<'days' | 'releases'>('days');
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Dashboard | null>(null);
  const [choices, setChoices] = useState<ReleaseBoundary[]>([]);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [catalogCache, setCatalogCache] = useState<ReleaseCacheState | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const requestId = useRef(0);
  const syncId = useRef(0);
  const syncBusy = useRef(false);
  const pendingRange = useRef(false);
  const selected = repositories.find((r) => r.id === projectId);
  useEffect(() => {
    if (!selected && repositories.length) onProjectChange(repositories[0].id);
  }, [selected, repositories, onProjectChange]);
  const valid = mode === 'days' || (!!from && !!to && from !== to);
  const query = new URLSearchParams({
    repo: projectId,
    scope: 'project',
    range: mode,
    days: String(days),
    ...(mode === 'releases' ? { fromRelease: from, toRelease: to } : {}),
  }).toString();
  const refresh = useCallback(async () => {
    if (!projectId || !valid) return;
    const id = ++requestId.current;
    const catalogRequest = syncId.current;
    setBusy(true);
    try {
      const next = await api<Dashboard>(`/dashboard?${query}`);
      if (id === requestId.current) {
        setData(next);
        if (catalogRequest === syncId.current && !syncBusy.current) {
          setChoices(next.releaseChoices);
          setNextPage(next.releaseCatalog.nextPage);
        }
        setError('');
      }
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : '读取失败，请重试。');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [projectId, valid, query, refreshVersion]);
  useEffect(() => {
    setData(null);
  }, [projectId, query]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      requestId.current++;
      window.clearInterval(timer);
    };
  }, [refresh]);
  const sync = useCallback(
    async (page = 1) => {
      if (!projectId || syncBusy.current) return;
      const id = ++syncId.current;
      syncBusy.current = true;
      setSyncing(true);
      setSyncError('');
      try {
        const result = await api<{ nextPage: number | null; cache?: ReleaseCacheState }>(
          `/repositories/${projectId}/releases/sync`,
          { method: 'POST', body: { page } },
        );
        if (id !== syncId.current) return;
        setCatalogCache(result.cache ?? null);
        const catalog = await api<Dashboard>(
          `/dashboard?${new URLSearchParams({ repo: projectId, scope: 'project', days: '30' })}`,
        );
        if (id !== syncId.current) return;
        setChoices(catalog.releaseChoices);
        setNextPage(result.nextPage);
      } catch (e) {
        if (id === syncId.current)
          setSyncError(e instanceof Error ? e.message : '同步失败，请稍后重试。');
      } finally {
        if (id === syncId.current) {
          syncBusy.current = false;
          setSyncing(false);
          setRefreshVersion((value) => value + 1);
        }
      }
    },
    [projectId],
  );
  useEffect(() => {
    setChoices([]);
    setCatalogCache(null);
    setNextPage(null);
    void sync();
    return () => {
      syncId.current++;
      syncBusy.current = false;
    };
  }, [sync]);
  useEffect(() => {
    if (mode !== 'releases' || !pendingRange.current) return;
    const end = choices[0];
    const start = end ? choices.find((r) => r.published_at < end.published_at) : undefined;
    if (start && end) {
      pendingRange.current = false;
      setFrom(String(start.github_id));
      setTo(String(end.github_id));
    }
  }, [mode, choices]);
  function switchMode(value: string) {
    pendingRange.current = false;
    if (value !== 'releases') {
      setMode('days');
      setDays(Number(value));
      return;
    }
    setMode('releases');
    const end = choices[0];
    const start = end ? choices.find((r) => r.published_at < end.published_at) : undefined;
    pendingRange.current = !start;
    setFrom(start ? String(start.github_id) : '');
    setTo(end ? String(end.github_id) : '');
  }
  if (!repositories.length)
    return (
      <section className="panel empty-projects">
        <h2>先添加一个项目</h2>
        <p>项目数据按单个仓库展示，添加项目后即可查看。</p>
      </section>
    );
  return (
    <div className="project-data-view">
      <div className="project-controls">
        <div className="filterbar-controls">
          <div className="select-wrap">
            <FolderGit2 size={16} />
            <select
              aria-label="项目数据选择项目"
              value={projectId}
              onChange={(e) => {
                syncId.current++;
                syncBusy.current = false;
                setSyncError('');
                setSyncing(false);
                setMode('days');
                setFrom('');
                setTo('');
                pendingRange.current = false;
                setChoices([]);
                setNextPage(null);
                setError('');
                onProjectChange(e.target.value);
              }}
            >
              {repositories.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="select-wrap">
            <select
              aria-label="项目统计时间"
              value={mode === 'releases' ? 'releases' : String(days)}
              onChange={(e) => switchMode(e.target.value)}
            >
              <option value="7">近 7 天</option>
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="releases">两个 Release 之间</option>
            </select>
          </div>
        </div>
        <div className="project-sync-actions">
          <button
            className="button secondary"
            disabled={syncing || !selected}
            onClick={() => void sync()}
          >
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            {syncing ? '正在读取公开 Release…' : '刷新公开 Release'}
          </button>
          {nextPage !== null && (
            <button className="text-button" disabled={syncing} onClick={() => void sync(nextPage)}>
              加载更早 Release
            </button>
          )}
        </div>
      </div>
      <ReleaseCacheNote cache={catalogCache} />
      {mode === 'releases' && (
        <div className="release-range panel">
          <label>
            起始 Release
            <select
              aria-label="起始 Release"
              value={from}
              onChange={(e) => {
                pendingRange.current = false;
                setFrom(e.target.value);
              }}
            >
              <option value="">选择起始版本</option>
              {choices.map((r) => (
                <option key={r.github_id} value={r.github_id}>
                  {r.tag_name}
                  {r.prerelease ? '（预发布）' : ''} · {when(r.published_at)}
                </option>
              ))}
            </select>
          </label>
          <span className="range-arrow">→</span>
          <label>
            结束 Release
            <select
              aria-label="结束 Release"
              value={to}
              onChange={(e) => {
                pendingRange.current = false;
                setTo(e.target.value);
              }}
            >
              <option value="">选择结束版本</option>
              {choices.map((r) => (
                <option key={r.github_id} value={r.github_id}>
                  {r.tag_name}
                  {r.prerelease ? '（预发布）' : ''} · {when(r.published_at)}
                </option>
              ))}
            </select>
          </label>
          <p>
            按发布时间统计：包含起始时刻，不含结束时刻。版本在打开页面时读取，可刷新或加载更早
            Release；历史事件只能覆盖已经收到的数据。
          </p>
        </div>
      )}
      {(error || syncError) && (
        <div className="error-banner" role="alert">
          <span>{syncError || error}</span>
          <button onClick={() => void (syncError ? sync() : refresh())}>重试</button>
        </div>
      )}
      {!valid ? (
        <p className="panel small-empty">请选择两个发布时间不同的 Release。</p>
      ) : !data ? (
        <p className="panel small-empty">
          {busy
            ? '正在读取项目统计…'
            : error
              ? '所选范围暂时无法读取，请调整选择或重试。'
              : '请选择项目查看数据。'}
        </p>
      ) : (
        <>
          <div className="range-description">
            <strong>
              {selected?.full_name} · {data.range.label}
            </strong>
            <span>
              {when(data.range.since)} 至 {when(data.range.until)} ·{' '}
              {data.range.bucketDays === 1 ? '按自然日' : `每 ${data.range.bucketDays} 天分组`}
            </span>
            {data.range.partial && (
              <small>
                该范围包含监控记录开始之前的时间；仅统计实际收到的事件
                {data.range.coverageStart ? `，监控始于 ${when(data.range.coverageStart)}` : ''}。
              </small>
            )}
          </div>
          <Monitoring
            key={projectId}
            repo={projectId}
            days={days}
            metrics={data.metrics}
            history={data.history}
            repositories={repositories}
            dashboard={data}
            rangeQuery={query}
            refreshVersion={refreshVersion}
            syncingReleases={syncing}
            onRefreshReleases={() => sync()}
          />
        </>
      )}
    </div>
  );
}
