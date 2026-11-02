import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  GitFork,
  GitPullRequest,
  Inbox,
  MessageCircle,
  RefreshCw,
  Tag,
  Star,
} from 'lucide-react';
import type {
  Dashboard,
  MonitorData,
  MonitorMetrics,
  MonitorType,
  RepoSummary,
  WorkItem,
} from '../shared/types';
import { categoryLabels, type Category } from '../shared/monitors';
import { api } from './api';
import { ForkChart, WorkChart, TrendChart, ChangesChart } from './Charts';
import { ReleaseAssets } from './ReleaseAssets';
import { ReleaseDownloads } from './ReleaseDownloads';

export const duration = (seconds: number | null) =>
  seconds === null
    ? '—'
    : seconds < 60
      ? `${Math.max(0, Math.round(seconds))} 秒`
      : seconds < 3600
        ? `${Math.round(seconds / 60)} 分钟`
        : seconds < 86400
          ? `${(seconds / 3600).toFixed(1)} 小时`
          : `${(seconds / 86400).toFixed(1)} 天`;
const when = (at: number | null) =>
  at
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(at * 1000))
    : '—';
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '读取失败，请重试。';
const stateLabels: Record<string, string> = {
  open: '进行中',
  closed: '已关闭',
  merged: '已合并',
  deleted: '已删除',
  approved: '已批准',
  changes_requested: '需修改',
  commented: '已评论',
  dismissed: '已撤销',
};
const actions: Record<string, string> = {
  created: '新增',
  deleted: '删除',
  opened: '新建',
  closed: '关闭',
  merged: '合并',
  reopened: '重新打开',
  edited: '编辑',
  published: '发布',
  released: '转为正式版',
  prereleased: '发布预览版',
  unpublished: '撤回发布',
  synchronize: '更新代码',
  review_requested: '请求评审',
  ready_for_review: '准备评审',
  converted_to_draft: '转为草稿',
  comment_created: '回复',
  comment_edited: '编辑回复',
  comment_deleted: '删除回复',
  review_submitted: '提交评审',
  review_dismissed: '撤销评审',
  review_edited: '编辑评审',
  labeled: '添加标签',
  unlabeled: '移除标签',
};
function PageButtons({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (value: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        共 {total.toLocaleString()} 条 · 第 {page} 页
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={page * 30 >= total}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
function Empty({ children }: { children: string }) {
  return (
    <div className="changes-empty">
      <span className="empty-star">
        <Inbox size={25} />
      </span>
      <strong>暂无记录</strong>
      <p>{children}</p>
    </div>
  );
}
function Metric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <article className="panel module-metric">
      <span>{label}</span>
      <strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong>
      <small>{note}</small>
    </article>
  );
}
function User({ login, id }: { login: string; id?: number }) {
  return (
    <a className="user-cell" href={`https://github.com/${login}`} target="_blank" rel="noreferrer">
      {id && (
        <img
          src={`https://avatars.githubusercontent.com/u/${id}?s=64`}
          alt=""
          width="28"
          height="28"
          loading="lazy"
        />
      )}
      <strong>{login}</strong>
    </a>
  );
}
function ItemState({ item }: { item: WorkItem }) {
  return (
    <span
      className={`pill ${item.state === 'open' ? 'green' : item.state === 'merged' ? 'blue' : 'neutral'}`}
    >
      {item.draft && item.state === 'open' ? '草稿' : stateLabels[item.state]}
    </span>
  );
}

export function Monitoring({
  repo,
  days,
  metrics,
  history,
  repositories,
  dashboard,
  rangeQuery,
}: {
  repo: string;
  days: number;
  metrics: MonitorMetrics;
  history: Dashboard['history'];
  repositories: RepoSummary[];
  dashboard: Dashboard;
  rangeQuery: string;
}) {
  const [type, setType] = useState<MonitorType>('stars');
  const [state, setState] = useState('all');
  const [starMode, setStarMode] = useState('net');
  const [starKind, setStarKind] = useState('all');
  const [assetId, setAssetId] = useState<number | null>(null);
  const [autoAsset, setAutoAsset] = useState(true);
  const [label, setLabel] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const releaseUpdatedAt = type === 'releases' ? dashboard.releaseCatalog.updatedAt : null;
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const parameters = new URLSearchParams(rangeQuery);
      for (const [key, value] of Object.entries({
        repo,
        type,
        state,
        label,
        page: String(page),
        starMode,
        starKind,
      }))
        parameters.set(key, value);
      const next = await api<MonitorData>(`/monitoring?${parameters}`);
      if (id === requestId.current) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (id === requestId.current) setError(errorText(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [repo, type, state, label, page, rangeQuery, starMode, starKind, releaseUpdatedAt]);
  useEffect(() => {
    setData(null);
    void load();
    const interval = type === 'releases' ? null : window.setInterval(() => void load(), 15000);
    return () => {
      if (interval !== null) window.clearInterval(interval);
      requestId.current++;
    };
  }, [load]);
  useEffect(() => {
    setPage(1);
  }, [repo]);
  useEffect(() => {
    if (type !== 'releases' || data?.type !== 'releases' || !autoAsset) return;
    const latest = data.releases
      .slice(0, 5)
      .find((r) => !r.draft && r.deleted_at === null && r.published_at !== null);
    setAssetId(latest?.github_id ?? null);
  }, [type, data, autoAsset]);
  const releaseRows = data?.type === 'releases' ? data.releases.slice(0, 5) : [];
  const options =
    type === 'issues'
      ? [
          ['all', '全部状态'],
          ['open', '未关闭'],
          ['unanswered', '未回复'],
          ['closed', '已关闭'],
          ['deleted', '已删除'],
        ]
      : type === 'pull_requests'
        ? [
            ['all', '全部状态'],
            ['open', '未关闭'],
            ['awaiting_review', '待评审'],
            ['merged', '已合并'],
            ['closed', '已关闭'],
          ]
        : [
            ['all', '全部版本'],
            ['stable', '正式版'],
            ['prerelease', '预发布'],
            ['draft', '草稿'],
            ['deleted', '已删除'],
          ];
  const knownForks = repositories.filter(
    (r) => (!repo || r.id === repo) && r.current_forks !== null,
  );
  const period = dashboard.range.label;
  const grouping =
    dashboard.range.bucketDays === 1 ? '北京时间自然日' : `每 ${dashboard.range.bucketDays} 天分组`;
  const tabs = [
    { id: 'stars' as const, label: 'Star', icon: <Star size={16} /> },
    { id: 'forks' as const, label: 'Fork', icon: <GitFork size={16} /> },
    { id: 'issues' as const, label: 'Issue', icon: <MessageCircle size={16} /> },
    { id: 'pull_requests' as const, label: 'Pull Request', icon: <GitPullRequest size={16} /> },
    { id: 'releases' as const, label: 'Release', icon: <Tag size={16} /> },
  ];
  const tabBar = (
    <div className="monitor-tabs" role="tablist" aria-label="监控维度">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={type === tab.id}
          className={type === tab.id ? 'active' : ''}
          onClick={() => {
            if (tab.id === 'releases' && type !== 'releases') {
              setAutoAsset(true);
              setAssetId(null);
            }
            setType(tab.id);
            setState('all');
            setLabel('');
            setPage(1);
          }}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
  if (type === 'stars')
    return (
      <div className="monitor-view">
        {tabBar}
        <StarStatistics
          dashboard={dashboard}
          data={data}
          loading={loading}
          error={error}
          mode={starMode}
          kind={starKind}
          onMode={(value) => {
            setStarMode(value);
            setPage(1);
          }}
          onKind={(value) => {
            setStarKind(value);
            setPage(1);
          }}
          onPage={setPage}
          onRefresh={() => void load()}
        />
      </div>
    );
  return (
    <div className="monitor-view">
      {tabBar}
      {type === 'releases' && (
        <ReleaseDownloads repo={repo} rangeQuery={rangeQuery} cache={dashboard.releaseCatalog} />
      )}
      {type !== 'releases' && (
        <div className={`module-metrics ${type === 'forks' ? 'pair' : ''}`}>
          {type === 'forks' ? (
            <>
              <Metric
                label="截至区间末 Forks"
                value={
                  dashboard.history.at(-1)?.fork_repos ? dashboard.history.at(-1)!.fork_total : '—'
                }
                note="来自最近收到的仓库信息"
              />
              <Metric
                label={`${period}新增 Fork`}
                value={metrics.forks}
                note="按首次收到该 Fork 的时间统计"
              />
            </>
          ) : type === 'issues' ? (
            <>
              <Metric
                label="区间活跃 Issue 当前未关闭"
                value={metrics.openIssues}
                note="所选期间有活动的条目，显示当前状态"
              />
              <Metric
                label="其中未回复"
                value={metrics.unansweredIssues}
                note="没有收到其他人的人工回复"
              />
              <Metric
                label={`${period}新建 / 关闭`}
                value={`${metrics.issuesOpened} / ${metrics.issuesClosed}`}
                note="分别统计发生过对应操作的 Issue"
              />
              <Metric
                label="平均首条回复耗时"
                value={duration(metrics.avgReplySeconds)}
                note="已记录 Issue · 不含作者和机器人回复"
              />
            </>
          ) : (
            <>
              <Metric
                label="区间活跃 PR 当前未关闭"
                value={metrics.openPRs}
                note="所选期间有活动的 PR，显示当前状态"
              />
              <Metric
                label="其中待评审"
                value={metrics.awaitingReview}
                note="非草稿且尚无有效的已记录评审"
              />
              <Metric
                label={`${period}新建 / 合并 / 关闭`}
                value={`${metrics.prsOpened} / ${metrics.prsMerged} / ${metrics.prsClosed}`}
                note="关闭不含合并；按发生过对应操作的条目去重"
              />
              <Metric
                label="平均合并耗时"
                value={duration(metrics.avgMergeSeconds)}
                note="已记录 PR · 从创建到合并"
              />
            </>
          )}
        </div>
      )}
      {type === 'forks' && (
        <section className="panel module-chart">
          <div className="panel-header">
            <div>
              <h2>Fork 新增趋势</h2>
              <p>
                {grouping} · {period}
              </p>
            </div>
          </div>
          <ForkChart history={history} />
        </section>
      )}
      {(type === 'issues' || type === 'pull_requests') && (
        <section className="panel module-chart">
          <div className="panel-header">
            <div>
              <h2>{type === 'issues' ? 'Issue 每日变化' : 'PR 每日变化'}</h2>
              <p>{grouping} · 统计发生过对应操作的条目</p>
            </div>
          </div>
          <WorkChart history={history} mode={type} />
        </section>
      )}
      <section className="panel" aria-label={type === 'releases' ? 'Release 版本' : undefined}>
        <div className="panel-header">
          <div>
            <h2>
              {
                {
                  stars: 'Star 名单',
                  forks: 'Fork 名单',
                  issues: 'Issue 跟踪',
                  pull_requests: 'PR 跟踪',
                  releases: 'Release 版本',
                }[type]
              }
            </h2>
            <p>
              {type === 'forks'
                ? 'GitHub 只通知新增 Fork，无法据此追踪删除。'
                : type === 'releases'
                  ? '版本目录每小时更新，展示最近一次采集结果；产物下载量可实时刷新。'
                  : '只展示所选期间有事件的条目，状态为当前已记录状态。'}
            </p>
          </div>
          <div className="module-filters">
            {type !== 'forks' && (
              <select
                aria-label="筛选状态"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setPage(1);
                }}
              >
                {options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            {(type === 'issues' || type === 'pull_requests') && (
              <select
                aria-label="筛选标签"
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部标签</option>
                {data?.labels.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            {type !== 'releases' && (
              <button
                className="icon-button"
                aria-label="刷新监控数据"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => void load()}>重试</button>
          </div>
        )}
        {!data ? (
          <p className="small-empty">正在读取记录…</p>
        ) : !data.total ? (
          <Empty>
            {type === 'releases'
              ? '暂无已采集的公开 Release，等待下一次每小时采集。'
              : '在 GitHub Webhook 中勾选对应事件，收到新事件后会出现在这里。'}
          </Empty>
        ) : (
          <>
            <div className="table-scroll">
              <table className="monitor-table">
                <thead>
                  <tr>
                    {type === 'forks' ? (
                      <>
                        <th>Fork 仓库 / 所属用户</th>
                        <th>来源项目</th>
                        <th>创建时间</th>
                        <th>首次收到</th>
                      </>
                    ) : type === 'releases' ? (
                      <>
                        <th>版本 / 项目</th>
                        <th>状态</th>
                        <th>发布者</th>
                        <th>发布时间</th>
                        <th>距上次发布</th>
                        <th>产物下载量</th>
                      </>
                    ) : (
                      <>
                        <th>标题 / 标签</th>
                        <th>作者</th>
                        <th>状态</th>
                        <th>{type === 'issues' ? '首条回复耗时' : '最近评审'}</th>
                        <th>{type === 'issues' ? '创建时间' : '合并耗时'}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {type === 'forks'
                    ? data.forks.map((f) => (
                        <tr key={`${f.project_id}:${f.github_id}`}>
                          <td>
                            <a
                              className="record-title"
                              href={`https://github.com/${f.full_name}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {f.full_name}
                              <ArrowUpRight size={13} />
                            </a>
                            <small>
                              <a
                                href={`https://github.com/${f.owner_login}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {f.owner_login}
                              </a>
                            </small>
                          </td>
                          <td>{f.source_name}</td>
                          <td>{when(f.created_at)}</td>
                          <td>{when(f.received_at)}</td>
                        </tr>
                      ))
                    : type === 'releases'
                      ? releaseRows.map((r) => (
                          <tr key={`${r.project_id}:${r.github_id}`}>
                            <td>
                              <a
                                className="record-title"
                                href={`https://github.com/${r.full_name}/releases/tag/${encodeURIComponent(r.tag_name)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {r.tag_name}
                                <ArrowUpRight size={13} />
                              </a>
                              <small>
                                {r.name} · {r.full_name}
                              </small>
                            </td>
                            <td>
                              <span
                                className={`pill ${r.deleted_at ? 'neutral' : r.draft ? 'neutral' : r.prerelease ? 'blue' : 'green'}`}
                              >
                                {r.deleted_at
                                  ? '已删除'
                                  : r.draft
                                    ? '草稿 / 已撤回'
                                    : r.prerelease
                                      ? '预发布'
                                      : '正式版'}
                              </span>
                            </td>
                            <td>
                              <User login={r.author_login} />
                            </td>
                            <td>{when(r.published_at)}</td>
                            <td>
                              {r.published_at && r.previous_published_at
                                ? duration(r.published_at - r.previous_published_at)
                                : '—'}
                            </td>
                            <td>
                              <button
                                className="text-button"
                                aria-label={`${r.tag_name} 产物下载量`}
                                onClick={() => {
                                  setAutoAsset(false);
                                  setAssetId(r.github_id);
                                }}
                              >
                                查看产物
                                {r.assets_count === undefined || r.assets_count === null
                                  ? ''
                                  : `（${r.assets_count}）`}
                              </button>
                            </td>
                          </tr>
                        ))
                      : data.items.map((w) => (
                          <tr key={`${w.project_id}:${w.kind}:${w.number}`}>
                            <td>
                              <a
                                className="record-title"
                                href={`https://github.com/${w.full_name}/${w.kind === 'issue' ? 'issues' : 'pull'}/${w.number}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                #{w.number} {w.title}
                                <ArrowUpRight size={13} />
                              </a>
                              <small>{w.full_name}</small>
                              <div className="label-list">
                                {w.labels.map((name) => (
                                  <button
                                    key={name}
                                    onClick={() => {
                                      setLabel(name);
                                      setPage(1);
                                    }}
                                  >
                                    {name}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td>
                              <User login={w.author_login} id={w.author_id} />
                            </td>
                            <td>
                              <ItemState item={w} />
                            </td>
                            <td>
                              {type === 'issues' ? (
                                duration(
                                  w.first_reply_at === null
                                    ? null
                                    : w.first_reply_at - w.created_at,
                                )
                              ) : w.review_state ? (
                                <span className="pill blue">
                                  {stateLabels[w.review_state] ?? w.review_state}
                                </span>
                              ) : (
                                <span className="muted">待评审</span>
                              )}
                            </td>
                            <td>
                              {type === 'issues'
                                ? when(w.created_at)
                                : duration(
                                    w.merged_at === null ? null : w.merged_at - w.created_at,
                                  )}
                            </td>
                          </tr>
                        ))}
                </tbody>
              </table>
            </div>
            {type !== 'releases' && (
              <PageButtons page={data.page} total={data.total} onPage={setPage} />
            )}
          </>
        )}
        {type === 'releases' && data && (
          <div className="pagination" role="status">
            已显示 {releaseRows.length} 个 Release，另有{' '}
            {Math.max(0, data.total - releaseRows.length)} 个已缓存版本未显示。
          </div>
        )}
      </section>
      {type === 'pull_requests' && !!data?.contributors.length && (
        <section className="panel contributors-panel">
          <div className="panel-header">
            <div>
              <h2>已记录的贡献者</h2>
              <p>{metrics.contributors} 位 PR 作者 · 按已记录 PR 数量排序</p>
            </div>
          </div>
          <div className="contributors-list">
            {data.contributors.map((person) => (
              <div key={person.id}>
                <User login={person.login} id={person.id} />
                <small>
                  {person.prs} 个 PR · {person.merged} 个已合并
                </small>
              </div>
            ))}
          </div>
        </section>
      )}
      {type === 'releases' && assetId !== null && (
        <ReleaseAssets
          key={`${repo}:${assetId}`}
          repo={repo}
          releaseId={assetId}
          onClose={() => {
            setAutoAsset(false);
            setAssetId(null);
          }}
        />
      )}
    </div>
  );
}

export function ActivityFeed({
  data,
  category,
  onCategory,
  onPage,
  preview = false,
  onViewAll,
}: {
  data: Dashboard;
  category: string;
  onCategory: (value: string) => void;
  onPage: (page: number) => void;
  preview?: boolean;
  onViewAll?: () => void;
}) {
  const events = preview ? (data.recentEvents ?? []).slice(0, 5) : data.timeline;
  return (
    <section className="panel changes-panel" aria-label={preview ? '最近项目动态' : '项目动态'}>
      <div className="panel-header">
        <div>
          <h2>{preview ? '最近项目动态' : '项目动态'}</h2>
          <p>
            {preview
              ? '所选范围内的所有类型事件 · 最近 5 条 · 北京时间'
              : '所有维度的已收到事件 · 北京时间'}
          </p>
        </div>
        {preview && onViewAll && (
          <button className="text-button" onClick={onViewAll}>
            查看全部动态
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      {!preview && (
        <div className="change-tabs feed-tabs">
          {[['all', '全部'], ...Object.entries(categoryLabels)].map(([value, label]) => (
            <button
              key={value}
              className={category === value ? 'active' : ''}
              onClick={() => onCategory(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {events.length ? (
        <>
          <div className="table-scroll">
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>事件 / 内容</th>
                  <th>项目</th>
                  <th>操作用户</th>
                  <th>收到时间</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <span
                        className={`pill ${event.action === 'deleted' || event.action === 'closed' ? 'neutral' : 'blue'}`}
                      >
                        {categoryLabels[event.category as Category]} ·{' '}
                        {event.category === 'star'
                          ? event.action === 'created'
                            ? '新增关注'
                            : '取消关注'
                          : (actions[event.action] ?? event.action)}
                      </span>
                      <a
                        className="record-title feed-title"
                        href={event.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {event.number ? `#${event.number} ` : ''}
                        {event.title}
                        <ArrowUpRight size={13} />
                      </a>
                    </td>
                    <td>{event.full_name}</td>
                    <td>
                      <User login={event.actor_login} id={event.actor_id} />
                    </td>
                    <td>{when(event.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!preview && <PageButtons page={data.page} total={data.timelineTotal} onPage={onPage} />}
        </>
      ) : (
        <Empty>配置对应的 GitHub Webhook 事件后，这里会持续记录项目的变化。</Empty>
      )}
    </section>
  );
}

function StarStatistics({
  dashboard,
  data,
  loading,
  error,
  mode,
  kind,
  onMode,
  onKind,
  onPage,
  onRefresh,
}: {
  dashboard: Dashboard;
  data: MonitorData | null;
  loading: boolean;
  error: string;
  mode: string;
  kind: string;
  onMode: (value: string) => void;
  onKind: (value: string) => void;
  onPage: (value: number) => void;
  onRefresh: () => void;
}) {
  const last = dashboard.history.at(-1);
  const net = dashboard.starNet;
  return (
    <>
      <div className="module-metrics">
        <Metric
          label="截至区间末 Stars"
          value={last?.repos ? last.total : '—'}
          note="结束时刻之前最近一次上报值"
        />
        <Metric label="区间净新增用户" value={net.added} note="同一用户区间内相反操作相互抵消" />
        <Metric label="区间净取消用户" value={net.removed} note="按 GitHub 稳定用户 ID 识别" />
        <Metric
          label="区间用户净变化"
          value={`${net.added - net.removed > 0 ? '+' : ''}${net.added - net.removed}`}
          note={`共收到 ${dashboard.eventCounts.added} 次新增、${dashboard.eventCounts.removed} 次取消事件`}
        />
      </div>
      <div className="chart-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>项目 Star 总量</h2>
              <p>{dashboard.range.label} · 结束时刻之前最近上报值</p>
            </div>
          </div>
          <TrendChart history={dashboard.history} markers={dashboard.releaseMarkers} />
          <div className="chart-legend">
            <span>
              <i className="legend-dot purple" />
              当前项目版本发布
            </span>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>区间 Star 净变化</h2>
              <p>
                {dashboard.range.bucketDays === 1
                  ? '按自然日'
                  : `每 ${dashboard.range.bucketDays} 天分组`}{' '}
                · 同一用户反向操作相互抵消
              </p>
            </div>
          </div>
          <ChangesChart history={dashboard.history} fullRange />
          <div className="chart-legend">
            <span>
              <i className="legend-dot green" />
              新增
            </span>
            <span>
              <i className="legend-dot red" />
              取消
            </span>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Star 用户记录</h2>
            <p>按所选区间内收到的事件统计</p>
          </div>
          <div className="module-filters">
            <select
              aria-label="Star 记录方式"
              value={mode}
              onChange={(e) => onMode(e.target.value)}
            >
              <option value="net">区间用户净变化</option>
              <option value="events">逐次 Star 事件</option>
            </select>
            <select
              aria-label="Star 变化类型"
              value={kind}
              onChange={(e) => onKind(e.target.value)}
            >
              <option value="all">全部变化</option>
              <option value="added">新增 Star</option>
              <option value="removed">取消 Star</option>
            </select>
            <button
              className="icon-button"
              aria-label="刷新 Star 数据"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {!data ? (
          <p className="small-empty">正在读取 Star 记录…</p>
        ) : !data.total ? (
          <Empty>所选时间和筛选条件内暂无 Star 用户变化。</Empty>
        ) : (
          <>
            <div className="table-scroll">
              <table className="monitor-table">
                <thead>
                  <tr>
                    <th>GitHub 用户</th>
                    <th>变化</th>
                    <th>收到时间 · 北京时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stars.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <User login={item.login} id={item.user_id} />
                      </td>
                      <td>
                        <span className={`pill ${item.kind === 'added' ? 'green' : 'red'}`}>
                          {item.kind === 'added' ? '新增 Star' : '取消 Star'}
                        </span>
                      </td>
                      <td>{when(item.observed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PageButtons page={data.page} total={data.total} onPage={onPage} />
          </>
        )}
      </section>
    </>
  );
}
