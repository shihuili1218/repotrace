import { Activity, ChartNoAxesCombined } from 'lucide-react';
import type { Dashboard } from '../shared/types';

export function TrendChart({ history }: { history: Dashboard['history'] }) {
  const data = history.filter((p) => p.repos > 0);
  if (!data.length)
    return (
      <div className="chart-empty">
        <ChartNoAxesCombined size={32} />
        <strong>让时间记录你的成长</strong>
        <span>连接 Webhook 后，这里会展示初始基线与每日汇总。</span>
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

export function ChangesChart({ history }: { history: Dashboard['history'] }) {
  const data = history.slice(-14);
  if (!data.some((p) => p.repos > 0))
    return (
      <div className="chart-empty compact">
        <Activity size={28} />
        <strong>变化即将发生</strong>
        <span>每晚汇总已收到的新增与取消事件。</span>
      </div>
    );
  const max = Math.max(1, ...data.flatMap((p) => [p.added, p.removed]));
  return (
    <svg
      className="changes-svg"
      viewBox="0 0 360 232"
      role="img"
      aria-label="近 14 天 Star 新增与取消柱状图"
    >
      {[42, 112, 182].map((y) => (
        <line key={y} x1="20" x2="340" y1={y} y2={y} className="grid-line" />
      ))}
      {data.map((p, i) => (
        <g key={p.day}>
          <rect
            x={25 + i * 23}
            y={112 - (p.added / max) * 66}
            width="10"
            height={Math.max(p.added ? 2 : 0, (p.added / max) * 66)}
            rx="3"
            fill="#3bab86"
          >
            <title>
              {p.day} · 新增 {p.added}
            </title>
          </rect>
          <rect
            x={25 + i * 23}
            y="115"
            width="10"
            height={Math.max(p.removed ? 2 : 0, (p.removed / max) * 66)}
            rx="3"
            fill="#f18d8d"
          >
            <title>
              {p.day} · 取消 {p.removed}
            </title>
          </rect>
          {(i === 0 || i === 6 || i === 13) && (
            <text x={30 + i * 23} y="215" textAnchor="middle" className="axis-label">
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
