import { Activity, ChartNoAxesCombined } from 'lucide-react';
import type { Dashboard, ReleaseRecord } from '../shared/types';

export function TrendChart({
  history,
  markers = [],
}: {
  history: Dashboard['history'];
  markers?: ReleaseRecord[];
}) {
  const data = history.filter((p) => p.repos > 0);
  if (!data.length)
    return (
      <div className="chart-empty">
        <ChartNoAxesCombined size={32} />
        <strong>让时间记录你的成长</strong>
        <span>收到仓库上报后，图表会随事件实时更新。</span>
      </div>
    );
  const max = Math.max(5, ...data.map((p) => p.total));
  const ceiling = Math.ceil(max / 5) * 5;
  const point = (i: number, total: number) => [
    64 + (i / Math.max(1, data.length - 1)) * 696,
    196 - (total / ceiling) * 164,
  ];
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${point(i, p.total).join(',')}`).join(' ');
  return (
    <svg className="trend-svg" viewBox="0 0 800 242" role="img" aria-label="每日 Star 总数趋势图">
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5369ef" stopOpacity=".2" />
          <stop offset="100%" stopColor="#5369ef" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1="64" x2="772" y1={196 - i * 41} y2={196 - i * 41} className="grid-line" />
          <text x="48" y={201 - i * 41} textAnchor="end" className="axis-label">
            {Math.round((ceiling / 4) * i).toLocaleString()}
          </text>
        </g>
      ))}
      <path
        d={`${line} L${point(data.length - 1, 0).join(',')} L64,196 Z`}
        fill="url(#trend-fill)"
      />
      <path
        d={line}
        fill="none"
        stroke="#4c62e8"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {data.map((p, i) => {
        const releases = markers.filter(
          (r) =>
            r.published_at &&
            new Date((r.published_at + 8 * 3600) * 1000).toISOString().slice(0, 10) === p.day,
        );
        return releases.length ? (
          <g key={`release-${p.day}`}>
            <line
              x1={point(i, p.total)[0]}
              x2={point(i, p.total)[0]}
              y1="25"
              y2="196"
              stroke="#a18bd2"
              strokeDasharray="4 5"
            />
            <circle cx={point(i, p.total)[0]} cy="23" r="5" fill="#9c7bc9">
              <title>
                {releases
                  .map((r) => `${r.full_name} ${r.tag_name}${r.prerelease ? '（预发布）' : ''}`)
                  .join('、')}
              </title>
            </circle>
          </g>
        ) : null;
      })}
      {data.map((p, i) => (
        <circle
          key={p.day}
          cx={point(i, p.total)[0]}
          cy={point(i, p.total)[1]}
          r={data.length < 10 ? 4 : 2.5}
          fill="#4c62e8"
          stroke="white"
          strokeWidth="1.5"
        >
          <title>
            {p.day} · {p.total.toLocaleString()} Stars · 已有 {p.repos} 个项目的上报数据
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
}: {
  history: Dashboard['history'];
  fullRange?: boolean;
}) {
  const data = fullRange ? history : history.slice(-14);
  const step = 320 / Math.max(1, data.length);
  const barWidth = Math.min(10, step * 0.65);
  if (!data.some((p) => p.repos > 0))
    return (
      <div className="chart-empty compact">
        <Activity size={28} />
        <strong>变化即将发生</strong>
        <span>按北京时间自然日实时计算新增与取消。</span>
      </div>
    );
  const max = Math.max(1, ...data.flatMap((p) => [p.added, p.removed]));
  return (
    <svg
      className="changes-svg"
      viewBox="0 0 360 232"
      role="img"
      aria-label={fullRange ? '区间 Star 新增与取消柱状图' : '近 14 天 Star 新增与取消柱状图'}
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
            rx="3"
            fill="#3bab86"
          >
            <title>
              {p.day} · 新增 {p.added}
            </title>
          </rect>
          <rect
            x={20 + (i + 0.5) * step - barWidth / 2}
            y="115"
            width={barWidth}
            height={Math.max(p.removed ? 2 : 0, (p.removed / max) * 66)}
            rx="3"
            fill="#f18d8d"
          >
            <title>
              {p.day} · 取消 {p.removed}
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
          所选时间内暂无每日变化
        </text>
      )}
    </svg>
  );
}

export function ForkChart({ history }: { history: Dashboard['history'] }) {
  const max = Math.max(1, ...history.map((p) => p.fork_new));
  const step = 696 / Math.max(1, history.length);
  return (
    <svg className="trend-svg" viewBox="0 0 800 242" role="img" aria-label="每日新增 Fork 趋势图">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1="64" x2="772" y1={196 - i * 41} y2={196 - i * 41} className="grid-line" />
          <text x="48" y={201 - i * 41} textAnchor="end" className="axis-label">
            {Math.round((max * i) / 4)}
          </text>
        </g>
      ))}
      {history.map((p, i) => (
        <rect
          key={p.day}
          x={64 + i * step + step * 0.18}
          y={196 - (p.fork_new / max) * 164}
          width={Math.max(1, step * 0.64)}
          height={p.fork_new ? (p.fork_new / max) * 164 : 0}
          fill="#8291e4"
          rx="2"
        >
          <title>
            {p.day} · 新增 {p.fork_new} Fork
          </title>
        </rect>
      ))}
      {[...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])]
        .filter((i) => i >= 0)
        .map((i) => (
          <text
            key={i}
            x={64 + (i + 0.5) * step}
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
}: {
  history: Dashboard['history'];
  mode: 'issues' | 'pull_requests';
}) {
  const series =
    mode === 'issues'
      ? [
          { key: 'issue_opened' as const, label: '新建', color: '#8291e4' },
          { key: 'issue_closed' as const, label: '关闭', color: '#3bab86' },
        ]
      : [
          { key: 'pr_opened' as const, label: '新建', color: '#8291e4' },
          { key: 'pr_merged' as const, label: '合并', color: '#3bab86' },
          { key: 'pr_closed' as const, label: '直接关闭', color: '#b4bdcf' },
        ];
  const ceiling =
    Math.ceil(Math.max(4, ...history.flatMap((p) => series.map((s) => p[s.key]))) / 4) * 4;
  const step = 696 / Math.max(1, history.length);
  const width = Math.min(14, (step * 0.75) / series.length);
  return (
    <>
      <svg
        className="trend-svg"
        viewBox="0 0 800 242"
        role="img"
        aria-label={`${mode === 'issues' ? 'Issue' : 'PR'} 每日变化图`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1="64" x2="772" y1={196 - i * 41} y2={196 - i * 41} className="grid-line" />
            <text x="48" y={201 - i * 41} textAnchor="end" className="axis-label">
              {(ceiling * i) / 4}
            </text>
          </g>
        ))}
        {history.flatMap((p, i) =>
          series.map((s, j) => (
            <rect
              key={`${p.day}:${s.key}`}
              x={64 + (i + 0.5) * step + (j - series.length / 2) * width}
              y={196 - (p[s.key] / ceiling) * 164}
              width={Math.max(1, width - 1)}
              height={(p[s.key] / ceiling) * 164}
              fill={s.color}
              rx="2"
            >
              <title>
                {p.day} · {s.label} {p[s.key]}
              </title>
            </rect>
          )),
        )}
        {[...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])]
          .filter((i) => i >= 0)
          .map((i) => (
            <text
              key={i}
              x={64 + (i + 0.5) * step}
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
          <i className="legend-dot blue" />
          新建
        </span>
        <span>
          <i className="legend-dot green" />
          {mode === 'issues' ? '关闭' : '合并'}
        </span>
        {mode === 'pull_requests' && (
          <span>
            <i className="legend-dot gray" />
            直接关闭
          </span>
        )}
      </div>
    </>
  );
}
