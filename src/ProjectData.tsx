import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderGit2 } from 'lucide-react';
import type { Dashboard, RepoSummary, ReleaseBoundary } from '../shared/types';
import { api } from './api';
import { Monitoring } from './Monitoring';
import { ScheduledReleaseNote } from './ScheduledReleaseNote';
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
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
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
    if (!projectId) return;
    const id = ++requestId.current;
    setBusy(true);
    try {
      const parameters = valid
        ? query
        : new URLSearchParams({ repo: projectId, scope: 'project', days: '30' }).toString();
      const next = await api<Dashboard>(`/dashboard?${parameters}`);
      if (id === requestId.current) {
        setData(next);
        setChoices(next.releaseChoices);
        setError('');
      }
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e.message : '读取失败，请重试。');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [projectId, valid, query]);
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
  useEffect(() => {
    setChoices([]);
  }, [projectId]);
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
                setMode('days');
                setFrom('');
                setTo('');
                pendingRange.current = false;
                setChoices([]);
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
      </div>
      <ScheduledReleaseNote cache={data?.releaseCatalog} />
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
            按发布时间统计：包含起始时刻，不含结束时刻。版本目录展示最近一次采集结果；历史事件只能覆盖已经收到的数据。
          </p>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => void refresh()}>重试</button>
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
          />
        </>
      )}
    </div>
  );
}
