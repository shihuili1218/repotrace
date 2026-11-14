import { useId, useState } from 'react';
import { Activity, ChartNoAxesCombined } from 'lucide-react';
import type { Dashboard, ReleaseRecord } from '../shared/types';

const axisNumber = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);

const countCeiling = (maximum: number) => Math.max(4, Math.ceil(maximum / 4) * 4);
const bucketLabel = (day: string, bucketDays: number) =>
  bucketDays === 1 ? day : `${day} 起的分组 · 每 ${bucketDays} 天一组`;

const activitySeries = [
  { key: 'added', label: 'Star 净新增用户', color: 'var(--chart-star, #d9b66f)' },
  { key: 'fork_new', label: '新增 Fork', color: 'var(--chart-fork, #60c9a5)' },
  { key: 'issue_opened', label: '新建 Issue', color: 'var(--chart-issue, #79a9e8)' },
  { key: 'pr_merged', label: '已合并 PR', color: 'var(--chart-pr, #c68db7)' },
] as const;

export function ActivityTrendChart({ history }: { history: Dashboard['history'] }) {
  const chartId = useId();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const data = [...history].sort((a, b) => a.day.localeCompare(b.day));
  if (!data.length)
    return (
      <div className="chart-empty">
        <Activity size={28} />
        <strong>尚无项目活动记录</strong>
        <span>收到 Star、Fork、Issue 或 PR 事件后显示每日变化</span>
      </div>
    );

  const maximum = Math.max(1, ...data.flatMap((point) => activitySeries.map((s) => point[s.key])));
  const tick = Math.max(1, Math.ceil(maximum / 4));
  const ceiling = tick * 4;
  const times = data.map((point) => Date.parse(`${point.day}T00:00:00+08:00`));
  const duration = times[times.length - 1] - times[0];
  const x = (index: number) => (duration ? 88 + ((times[index] - times[0]) / duration) * 680 : 428);
  const y = (value: number) => 268 - (value / ceiling) * 220;
  const selectedIndex =
    selectedDay === null ? -1 : data.findIndex((point) => point.day === selectedDay);
  const active = selectedIndex < 0 ? data.length - 1 : selectedIndex;
  const detail = (index: number) =>
    `${data[index].day} · ${activitySeries.map((s) => `${s.label} ${data[index][s.key].toLocaleString('zh-CN')}`).join(' · ')}`;
  const hasActivity = data.some((point) => activitySeries.some((s) => point[s.key] > 0));
  const description =
    '按北京时间自然日统计已记录数量。Star 为当日净新增用户，同一用户的相反操作抵消；其余为新增 Fork、新建 Issue 和合并 PR 的数量。四条线共用数量坐标，不表示仓库累计总量。';

  return (
    <figure className="activity-trend" aria-label="每日项目活动趋势">
      <svg
        className="activity-trend-svg"
        viewBox="0 0 800 316"
        role="img"
        aria-label="项目每日活动趋势图"
        aria-describedby={`${chartId}-description`}
      >
        <desc id={`${chartId}-description`}>{description}</desc>
        <defs>
          {activitySeries.map((series) => (
            <linearGradient
              key={series.key}
              id={`${chartId}-${series.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={series.color} stopOpacity=".12" />
              <stop offset="100%" stopColor={series.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <text x="88" y="24" className="axis-label">
          每日数量
        </text>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1="88" x2="768" y1={y(tick * i)} y2={y(tick * i)} className="grid-line" />
            <text x="72" y={y(tick * i) + 5} textAnchor="end" className="axis-label">
              {axisNumber(tick * i)}
            </text>
          </g>
        ))}
        <line
          x1={x(active)}
          x2={x(active)}
          y1="48"
          y2="268"
          stroke="var(--chart-neutral, #81858d)"
          strokeDasharray="3 5"
          opacity=".5"
        />
        {activitySeries.map((series) => {
          const path = data
            .map((point, i) => {
              const endX = x(i);
              const endY = y(point[series.key]);
              if (i === 0) return `M${endX},${endY}`;
              const middleX = (x(i - 1) + endX) / 2;
              const startY = y(data[i - 1][series.key]);
              // Both controls stay between the observed endpoints, so the curve cannot overshoot.
              return `C${middleX},${startY} ${middleX},${endY} ${endX},${endY}`;
            })
            .join(' ');
          return (
            <g key={series.key}>
              <path
                d={`${path} L${x(data.length - 1)},268 L${x(0)},268 Z`}
                fill={`url(#${chartId}-${series.key})`}
              />
              <path
                d={path}
                fill="none"
                stroke={series.color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((point, i) => (
                <circle
                  key={point.day}
                  className="chart-point"
                  cx={x(i)}
                  cy={y(point[series.key])}
                  r={i === active ? 4.5 : 3}
                  fill={series.color}
                  stroke="var(--surface, #1b1b1d)"
                  strokeWidth="1.5"
                  opacity={i === active || data.length === 1 ? 1 : 0}
                >
                  <title>
                    {point.day} · {series.label} {point[series.key].toLocaleString('zh-CN')}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        {[
          ...new Set([
            0,
            Math.floor((data.length - 1) / 3),
            Math.floor(((data.length - 1) * 2) / 3),
            data.length - 1,
          ]),
        ].map((i) => (
          <text
            key={data[i].day}
            x={x(i)}
            y="300"
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            className="axis-label"
          >
            {data[i].day.slice(5).replace('-', '/')}
          </text>
        ))}
        {!hasActivity && (
          <text x="428" y="152" textAnchor="middle" className="axis-label">
            所选时间内尚未记录这四类变化
          </text>
        )}
      </svg>
      <div className="activity-trend-legend" aria-label="所选日期的各类活动">
        {activitySeries.map((series) => (
          <span key={series.key}>
            <i className="legend-dot" style={{ background: series.color }} />
            {series.label}
            <strong>{data[active][series.key].toLocaleString('zh-CN')}</strong>
          </span>
        ))}
      </div>
      {data.length > 1 && (
        <label className="activity-trend-control">
          <span>查看日期</span>
          <input
            type="range"
            aria-label="项目活动日期"
            aria-valuetext={detail(active)}
            min="0"
            max={data.length - 1}
            value={active}
            onChange={(event) => setSelectedDay(data[Number(event.target.value)].day)}
          />
          <time dateTime={data[active].day}>{data[active].day}</time>
        </label>
      )}
      <p className="activity-trend-detail sr-only" aria-live="polite">
        {detail(active)}
      </p>
      <figcaption className="activity-chart-note">
        Star 为当日净新增用户；Fork、Issue、PR 为当日已记录数量
      </figcaption>
    </figure>
  );
}

export function TrendChart({
  history,
  markers = [],
  bucketDays = 1,
}: {
  history: Dashboard['history'];
  markers?: ReleaseRecord[];
  bucketDays?: number;
}) {
  const fillId = useId();
  const data = history.filter((p) => p.repos > 0);
  if (!data.length)
    return (
      <div className="chart-empty">
        <ChartNoAxesCombined size={32} />
        <strong>尚无 Star 总量记录</strong>
        <span>收到包含仓库总量的 Webhook 后显示趋势</span>
      </div>
    );
  const ceiling = countCeiling(Math.max(0, ...data.map((p) => p.total)));
  const point = (i: number, total: number) => [
    104 + (i / Math.max(1, data.length - 1)) * 656,
    196 - (total / ceiling) * 164,
  ];
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${point(i, p.total).join(',')}`).join(' ');
  return (
    <svg
      className="trend-svg"
      viewBox="0 0 800 242"
      role="img"
      aria-label={bucketDays === 1 ? '每日 Star 总数趋势图' : `每 ${bucketDays} 天 Star 总数趋势图`}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-primary, #5fcfa4)" stopOpacity=".12" />
          <stop offset="100%" stopColor="var(--chart-primary, #5fcfa4)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1="104" x2="772" y1={196 - i * 41} y2={196 - i * 41} className="grid-line" />
          <text x="88" y={201 - i * 41} textAnchor="end" className="axis-label">
            {axisNumber((ceiling / 4) * i)}
          </text>
        </g>
      ))}
      <path
        d={`${line} L${point(data.length - 1, 0).join(',')} L104,196 Z`}
        fill={`url(#${fillId})`}
      />
      <path
        d={line}
        fill="none"
        stroke="var(--chart-primary, #5fcfa4)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {data.map((p, i) => {
        const bucketStart = Date.parse(`${p.day}T00:00:00+08:00`) / 1000;
        const bucketEnd = bucketStart + bucketDays * 86400;
        const releases = markers.filter(
          (release) =>
            release.published_at !== null &&
            release.published_at >= bucketStart &&
            release.published_at < bucketEnd,
        );
        return releases.length ? (
          <g key={`release-${p.day}`}>
            <line
              x1={point(i, p.total)[0]}
              x2={point(i, p.total)[0]}
              y1="25"
              y2="196"
              stroke="var(--chart-neutral, #81858d)"
              strokeDasharray="3 5"
            />
            <path
              d={`M${point(i, p.total)[0] - 4},19 L${point(i, p.total)[0] + 4},19 L${point(i, p.total)[0] + 4},27 L${point(i, p.total)[0] - 4},27 Z`}
              fill="var(--surface, #1b1b1d)"
              stroke="var(--chart-neutral, #81858d)"
              strokeWidth="1.5"
            >
              <title>
                {releases
                  .map((r) => `${r.full_name} ${r.tag_name}${r.prerelease ? '（预发布）' : ''}`)
                  .join('、')}
              </title>
            </path>
          </g>
        ) : null;
      })}
      {data.map((p, i) => (
        <circle
          key={p.day}
          cx={point(i, p.total)[0]}
          cy={point(i, p.total)[1]}
          className="chart-point"
          r={data.length < 10 || i === data.length - 1 ? 4 : 3}
          opacity={data.length < 10 || i === 0 || i === data.length - 1 ? 1 : 0}
          fill="var(--chart-primary, #5fcfa4)"
          stroke="var(--surface, #1b1b1d)"
          strokeWidth="1.5"
        >
          <title>
            {bucketLabel(p.day, bucketDays)} · {p.total.toLocaleString()} Stars · 已有 {p.repos}{' '}
            个项目的上报数据
          </title>
        </circle>
      ))}
      {[
        ...new Set([
          0,
          Math.floor((data.length - 1) / 3),
          Math.floor(((data.length - 1) * 2) / 3),
          data.length - 1,
        ]),
      ].map((i) => (
        <text key={i} x={point(i, 0)[0]} y="229" textAnchor="middle" className="axis-label">
          {data[i].day.slice(5).replace('-', '/')}
        </text>
      ))}
    </svg>
  );
}

export function ChangesChart({
  history,
  fullRange = false,
  bucketDays = 1,
}: {
  history: Dashboard['history'];
  fullRange?: boolean;
  bucketDays?: number;
}) {
  const data = fullRange ? history : history.slice(-14);
  const step = 320 / Math.max(1, data.length);
  const barWidth = Math.min(10, step * 0.65);
  if (!data.length)
    return (
      <div className="chart-empty compact">
        <Activity size={28} />
        <strong>尚无 Star 变化记录</strong>
        <span>收到 Star 事件后，按北京时间自然日记录新增与取消</span>
      </div>
    );
  const max = Math.max(1, ...data.flatMap((p) => [p.added, p.removed]));
  return (
    <svg
      className="changes-svg"
      viewBox="0 0 360 232"
      role="img"
      aria-label={`${fullRange ? '区间' : `近 ${14 * bucketDays} 天`} Star 新增与取消柱状图${bucketDays > 1 ? `（每 ${bucketDays} 天分组）` : ''}`}
    >
      {[42, 112, 182].map((y) => (
        <line key={y} x1="20" x2="340" y1={y} y2={y} className="grid-line" />
      ))}
      {data.map((p, i) => (
        <g key={p.day}>
          <rect
            x={20 + (i + 0.5) * step - barWidth / 2}
            y={112 - (p.added / max) * 66}
            width={barWidth}
            height={Math.max(p.added ? 2 : 0, (p.added / max) * 66)}
            rx="1"
            fill="var(--chart-positive, #5fcfa4)"
          >
            <title>
              {bucketLabel(p.day, bucketDays)} · 新增 {p.added}
            </title>
          </rect>
          <rect
            x={20 + (i + 0.5) * step - barWidth / 2}
            y="115"
            width={barWidth}
            height={Math.max(p.removed ? 2 : 0, (p.removed / max) * 66)}
            rx="1"
            fill="var(--chart-negative, #d28d88)"
          >
            <title>
              {bucketLabel(p.day, bucketDays)} · 取消 {p.removed}
            </title>
          </rect>
          {(i === 0 || i === Math.floor((data.length - 1) / 2) || i === data.length - 1) && (
            <text x={20 + (i + 0.5) * step} y="215" textAnchor="middle" className="axis-label">
              {p.day.slice(5).replace('-', '/')}
            </text>
          )}
        </g>
      ))}
      {!data.some((p) => p.added || p.removed) && (
        <text x="180" y="82" textAnchor="middle" className="axis-label">
          所选时间内暂无分组净变化
        </text>
      )}
    </svg>
  );
}

export function ForkChart({
  history,
  bucketDays = 1,
}: {
  history: Dashboard['history'];
  bucketDays?: number;
}) {
  const ceiling = countCeiling(Math.max(0, ...history.map((p) => p.fork_new)));
  const step = 656 / Math.max(1, history.length);
  return (
    <svg
      className="trend-svg"
      viewBox="0 0 800 242"
      role="img"
      aria-label={bucketDays === 1 ? '每日新增 Fork 趋势图' : `每 ${bucketDays} 天新增 Fork 趋势图`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1="104" x2="772" y1={196 - i * 41} y2={196 - i * 41} className="grid-line" />
          <text x="88" y={201 - i * 41} textAnchor="end" className="axis-label">
            {axisNumber((ceiling * i) / 4)}
          </text>
        </g>
      ))}
      {history.map((p, i) => (
        <rect
          key={p.day}
          x={104 + i * step + step * 0.18}
          y={196 - (p.fork_new / ceiling) * 164}
          width={Math.max(1, step * 0.64)}
          height={p.fork_new ? (p.fork_new / ceiling) * 164 : 0}
          fill="var(--chart-primary, #5fcfa4)"
          rx="2"
        >
          <title>
            {bucketLabel(p.day, bucketDays)} · 新增 {p.fork_new} Fork
          </title>
        </rect>
      ))}
      {[...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])]
        .filter((i) => i >= 0)
        .map((i) => (
          <text
            key={i}
            x={104 + (i + 0.5) * step}
            y="229"
            textAnchor="middle"
            className="axis-label"
          >
            {history[i]?.day.slice(5).replace('-', '/')}
          </text>
        ))}
      {!history.some((p) => p.fork_new) && (
        <text x="415" y="95" textAnchor="middle" className="axis-label">
          所选时间内尚未记录到新增 Fork
        </text>
      )}
    </svg>
  );
}

export function WorkChart({
  history,
  mode,
  bucketDays = 1,
}: {
  history: Dashboard['history'];
  mode: 'issues' | 'pull_requests';
  bucketDays?: number;
}) {
  const series =
    mode === 'issues'
      ? [
          { key: 'issue_opened' as const, label: '新建', color: 'var(--chart-neutral, #81858d)' },
          { key: 'issue_closed' as const, label: '关闭', color: 'var(--chart-primary, #5fcfa4)' },
        ]
      : [
          { key: 'pr_opened' as const, label: '新建', color: 'var(--chart-neutral, #81858d)' },
          { key: 'pr_merged' as const, label: '合并', color: 'var(--chart-primary, #5fcfa4)' },
          {
            key: 'pr_closed' as const,
            label: '直接关闭',
            color: 'var(--chart-secondary, #b1b4bc)',
          },
        ];
  const ceiling = countCeiling(Math.max(0, ...history.flatMap((p) => series.map((s) => p[s.key]))));
  const step = 656 / Math.max(1, history.length);
  const width = Math.min(14, (step * 0.75) / series.length);
  return (
    <>
      <svg
        className="trend-svg"
        viewBox="0 0 800 242"
        role="img"
        aria-label={`${mode === 'issues' ? 'Issue' : 'PR'} ${bucketDays === 1 ? '每日' : `每 ${bucketDays} 天`}变化图`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1="104" x2="772" y1={196 - i * 41} y2={196 - i * 41} className="grid-line" />
            <text x="88" y={201 - i * 41} textAnchor="end" className="axis-label">
              {axisNumber((ceiling * i) / 4)}
            </text>
          </g>
        ))}
        {history.flatMap((p, i) =>
          series.map((s, j) => (
            <rect
              key={`${p.day}:${s.key}`}
              x={104 + (i + 0.5) * step + (j - series.length / 2) * width}
              y={196 - (p[s.key] / ceiling) * 164}
              width={Math.max(1, width - 1)}
              height={(p[s.key] / ceiling) * 164}
              fill={s.color}
              rx="2"
            >
              <title>
                {bucketLabel(p.day, bucketDays)} · {s.label} {p[s.key]}
              </title>
            </rect>
          )),
        )}
        {[...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])]
          .filter((i) => i >= 0)
          .map((i) => (
            <text
              key={i}
              x={104 + (i + 0.5) * step}
              y="229"
              textAnchor="middle"
              className="axis-label"
            >
              {history[i]?.day.slice(5).replace('-', '/')}
            </text>
          ))}
        {!history.some((p) => series.some((s) => p[s.key])) && (
          <text x="415" y="95" textAnchor="middle" className="axis-label">
            所选时间内暂无对应变化
          </text>
        )}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-dot" style={{ background: series[0].color }} />
          新建
        </span>
        <span>
          <i className="legend-dot" style={{ background: series[1].color }} />
          {mode === 'issues' ? '关闭' : '合并'}
        </span>
        {mode === 'pull_requests' && (
          <span>
            <i className="legend-dot" style={{ background: series[2].color }} />
            直接关闭
          </span>
        )}
      </div>
    </>
  );
}
