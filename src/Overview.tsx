import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, GitBranch, Search } from 'lucide-react';
import type { Dashboard, RepoSummary } from '../shared/types';
import { ActivityTrendChart, ChangesChart, TrendChart } from './Charts';
import { duration } from './Monitoring';

const number = (value: number) => value.toLocaleString('zh-CN');
const reported = (value: number | null) => (value == null ? '—' : number(value));
const when = (at: number | null) =>
  at
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(at * 1000))
    : '尚未收到';

function Metric({
  title,
  value,
  children,
  note,
}: {
  title: string;
  value: string;
  children: ReactNode;
  note: string;
}) {
  return (
    <article className="stat-card" aria-label={title}>
      <div className="stat-top">{title}</div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-breakdown">{children}</div>
      <p>{note}</p>
    </article>
  );
}

export function Overview({
  data,
  repositories,
  days,
  onView,
  onConfigure,
  onManage,
}: {
  data: Dashboard;
  repositories: RepoSummary[];
  days: number;
  onView: (repo: string) => void;
  onConfigure: (repo: RepoSummary) => void;
  onManage: () => void;
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('stars');
  const [chart, setChart] = useState<'activity' | 'total' | 'changes'>('activity');
  function total(key: 'current_total' | 'current_forks' | 'current_open_items') {
    const known = repositories.filter((repo) => repo[key] != null);
    return {
      value: known.length ? number(known.reduce((sum, repo) => sum + repo[key]!, 0)) : '—',
      coverage: `${known.length} / ${repositories.length} 个项目已上报`,
    };
  }
  const stars = total('current_total');
  const forks = total('current_forks');
  const open = total('current_open_items');
  const connected = repositories.filter((repo) => repo.enabled && repo.last_received_at).length;
  const latestEvent = repositories.reduce(
    (latest, repo) => Math.max(latest, repo.last_received_at ?? 0),
    0,
  );
  const net = data.starNet.added - data.starNet.removed;
  const rows = repositories
    .filter((repo) =>
      `${repo.full_name} ${repo.description} ${repo.language ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.full_name.localeCompare(b.full_name)
        : sort === 'events'
          ? b.event_count - a.event_count
          : (b.current_total ?? -1) - (a.current_total ?? -1),
    );
  return (
    <>
      <section className="stats-grid" aria-label="监控统计">
        <Metric title="Stars" value={stars.value} note={`最近上报总量 · ${stars.coverage}`}>
          <span>
            新增事件 <b className="positive">+{number(data.eventCounts.added)}</b>
          </span>
          <span>
            取消事件 <b>{number(data.eventCounts.removed)}</b>
          </span>
        </Metric>
        <Metric title="Forks" value={forks.value} note={`最近上报总量 · ${forks.coverage}`}>
          <span>
            新增 Fork <b className="positive">+{number(data.metrics.forks)}</b>
          </span>
          <span>近 {days} 天</span>
        </Metric>
        <Metric title="未关闭事项" value={open.value} note={`Issue + PR · ${open.coverage}`}>
          <span>
            新建 Issue <b>{number(data.metrics.issuesOpened)}</b>
          </span>
          <span>
            关闭 Issue <b>{number(data.metrics.issuesClosed)}</b>
          </span>
        </Metric>
        <Metric
          title="已合并 PR"
          value={number(data.metrics.prsMerged)}
          note={`近 ${days} 天 · 关闭不含已合并`}
        >
          <span>
            新建 PR <b>{number(data.metrics.prsOpened)}</b>
          </span>
          <span>
            关闭未合并 <b>{number(data.metrics.prsClosed)}</b>
          </span>
        </Metric>
      </section>

      <div className="overview-analysis">
        <section className="panel primary-chart" aria-label="关注趋势">
          <div className="panel-header">
            <div>
              <h2>
                {chart === 'activity'
                  ? '项目活动趋势'
                  : chart === 'total'
                    ? 'Star 总量趋势'
                    : 'Star 每日变化'}
              </h2>
              <p>
                {chart === 'activity'
                  ? '关注与协作的每日记录'
                  : chart === 'total'
                    ? '每日最近上报值'
                    : '每日新增与取消用户'}{' '}
                · 近 {days} 天
              </p>
            </div>
            <div className="range-switch" role="group" aria-label="趋势图表方式">
              <button
                className={chart === 'activity' ? 'active' : ''}
                aria-pressed={chart === 'activity'}
                onClick={() => setChart('activity')}
              >
                活动
              </button>
              <button
                className={chart === 'total' ? 'active' : ''}
                aria-pressed={chart === 'total'}
                onClick={() => setChart('total')}
              >
                Star 总量
              </button>
              <button
                className={chart === 'changes' ? 'active' : ''}
                aria-pressed={chart === 'changes'}
                onClick={() => setChart('changes')}
              >
                Star 变化
              </button>
            </div>
          </div>
          <div className="trend-summary">
            <strong className={chart === 'activity' ? '' : net < 0 ? 'negative' : 'positive'}>
              {chart === 'activity'
                ? number(data.eventTotal)
                : `${net > 0 ? '+' : ''}${number(net)}`}
            </strong>
            <span>
              {chart === 'activity' ? `近 ${days} 天收到的事件` : '区间用户净变化'}
              <small>
                {chart === 'activity'
                  ? '包含关注、协作与发布等全部事件'
                  : '同一用户在区间内的相反操作抵消'}
              </small>
            </span>
          </div>
          {chart === 'activity' ? (
            <ActivityTrendChart history={data.history} />
          ) : chart === 'total' ? (
            <TrendChart history={data.history} />
          ) : (
            <>
              <ChangesChart history={data.history} fullRange />
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
            </>
          )}
          <div className="chart-footnote">
            <span>
              {chart === 'activity'
                ? '北京时间自然日 · 仅统计实际收到的数据'
                : chart === 'total'
                  ? '北京时间 · 无新上报时沿用最近值'
                  : '北京时间自然日 · 当日内相反操作抵消'}
            </span>
            <span>
              {chart === 'activity'
                ? '各曲线采用各自的事件统计口径'
                : chart === 'total'
                  ? '已上报项目数可能随日期变化'
                  : '每日变化之和可能与区间净变化不同'}
            </span>
          </div>
        </section>
        <aside className="panel attention-panel" aria-label="协作概况">
          <div className="panel-header">
            <div>
              <h2>待跟进</h2>
              <p>已记录条目的当前状态</p>
            </div>
            <GitBranch size={18} />
          </div>
          <dl className="attention-list">
            <div>
              <dt>
                <span className="trace-node" /> 未回复 Issue
                <small>{number(data.metrics.openIssues)} 个已记录 Issue 未关闭</small>
              </dt>
              <dd>{number(data.metrics.unansweredIssues)}</dd>
            </div>
            <div>
              <dt>
                <span className="trace-node hollow" /> 待评审 PR
                <small>{number(data.metrics.openPRs)} 个已记录 PR 未关闭</small>
              </dt>
              <dd>{number(data.metrics.awaitingReview)}</dd>
            </div>
          </dl>
          <div className="response-times">
            <span>近 {days} 天</span>
            <div>
              <span>平均首次回复</span>
              <strong>{duration(data.metrics.avgReplySeconds)}</strong>
            </div>
            <div>
              <span>平均合并耗时</span>
              <strong>{duration(data.metrics.avgMergeSeconds)}</strong>
            </div>
          </div>
          <div className="observation-summary">
            <h3>记录概况</h3>
            <dl>
              <div>
                <dt>已连接项目</dt>
                <dd>
                  {connected} / {repositories.length}
                </dd>
              </div>
              <div>
                <dt>已记录 PR 作者</dt>
                <dd>{number(data.metrics.contributors)}</dd>
              </div>
              <div>
                <dt>最近收到事件</dt>
                <dd>{when(latestEvent || null)}</dd>
              </div>
            </dl>
          </div>
          <p className="coverage-note">仅覆盖已收到的 Issue / PR，不能代表仓库全部待办</p>
        </aside>
      </div>

      <section className="panel repository-section" aria-label="仓库一览">
        <div className="panel-header">
          <div>
            <h2>
              仓库一览 <span className="heading-count">{repositories.length}</span>
            </h2>
            <p>
              {connected} 个已连接 · 近 {days} 天收到 {number(data.eventTotal)} 条事件
            </p>
          </div>
          <button className="text-button" onClick={onManage}>
            管理项目 <ArrowRight size={16} />
          </button>
        </div>
        <div className="repository-tools">
          <label className="repository-search">
            <Search size={16} />
            <input
              aria-label="搜索仓库"
              placeholder="搜索名称、语言或描述"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="repository-sort">
            <ArrowDown size={16} />
            <select
              aria-label="仓库排序"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="stars">Stars 最多</option>
              <option value="events">累计事件最多</option>
              <option value="name">仓库名称</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="repository-table">
            <thead>
              <tr>
                <th>项目</th>
                <th className="numeric">Stars</th>
                <th className="numeric">Forks</th>
                <th className="numeric">
                  未关闭<small>Issue + PR</small>
                </th>
                <th>事件记录</th>
                <th>连接</th>
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((repo) => (
                <tr key={repo.id} className="repo-card">
                  <td>
                    <button className="repo-name" onClick={() => onView(repo.id)}>
                      {repo.full_name}
                      <ArrowUpRight size={16} />
                    </button>
                    <p className="repository-description" title={repo.description}>
                      {repo.description || '暂无仓库描述'}
                    </p>
                    {repo.language && <small className="repo-language">{repo.language}</small>}
                  </td>
                  <td
                    className="numeric repo-metrics"
                    title={`Stars 上报：${when(repo.total_reported_at)}`}
                  >
                    {reported(repo.current_total)}
                  </td>
                  <td
                    className="numeric repo-metrics"
                    title={`Forks 上报：${when(repo.forks_reported_at)}`}
                  >
                    {reported(repo.current_forks)}
                  </td>
                  <td
                    className="numeric"
                    title={`未关闭事项上报：${when(repo.open_items_reported_at)}`}
                  >
                    {reported(repo.current_open_items)}
                  </td>
                  <td className="hook-timestamp">
                    <span>已记录 {number(repo.event_count)} 条事件</span>
                    <small>最近收到 {when(repo.last_received_at)}</small>
                  </td>
                  <td>
                    <span
                      className={`pill ${!repo.enabled ? 'neutral' : repo.last_received_at ? 'green' : 'blue'}`}
                    >
                      <span className="status-dot" />
                      {!repo.enabled ? '已暂停' : repo.last_received_at ? '已连接' : '待连接'}
                    </span>
                  </td>
                  <td className="repository-actions">
                    <button className="text-button" onClick={() => onView(repo.id)}>
                      查看数据
                    </button>
                    <button className="text-button" onClick={() => onConfigure(repo)}>
                      配置 Webhook
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="small-empty">没有匹配的仓库，请调整搜索条件</p>}
      </section>
    </>
  );
}
