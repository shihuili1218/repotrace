import { useState } from 'react';
import type { DownloadSummary } from '../shared/types';

export interface DownloadPoint {
  id: string;
  label: string;
  value: string | null;
}
const colors = [
  'var(--chart-primary, #5fcfa4)',
  'var(--chart-neutral, #81858d)',
  'color-mix(in srgb, var(--chart-neutral, #81858d) 75%, white)',
  'color-mix(in srgb, var(--chart-neutral, #81858d) 70%, var(--surface, #1b1b1d))',
  'color-mix(in srgb, var(--chart-neutral, #81858d) 55%, white)',
  'color-mix(in srgb, var(--chart-neutral, #81858d) 50%, var(--surface, #1b1b1d))',
  'color-mix(in srgb, var(--chart-neutral, #81858d) 35%, white)',
  'color-mix(in srgb, var(--chart-neutral, #81858d) 35%, var(--surface, #1b1b1d))',
];
const valueOf = (value: string | null) =>
  value !== null && /^\d+$/.test(value) ? BigInt(value) : null;
export const downloadNumber = (value: string | null | undefined) =>
  value == null ? '—' : /^\d+$/.test(value) ? BigInt(value).toLocaleString('zh-CN') : '—';

const downloadDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const downloadTime = (at: number) => downloadDate.format(new Date(at * 1000));
const axisNumber = (value: bigint): string => {
  if (value < 0n) return `−${axisNumber(-value)}`;
  const unit = value >= 100000000n ? 100000000n : value >= 10000n ? 10000n : 1n;
  if (unit === 1n) return value.toLocaleString('zh-CN');
  const decimal = ((value % unit) * 10n) / unit;
  return `${value / unit}${decimal ? `.${decimal}` : ''}${unit === 10000n ? '万' : '亿'}`;
};

export function DownloadGrowth({ history }: { history: DownloadSummary['history'] }) {
  const data = history
    .filter((p) => valueOf(p.total) !== null)
    .slice()
    .sort((a, b) => a.observedAt - b.observedAt);
  return (
    <div className="metric-chart-grid download-growth-grid">
      <DownloadDelta history={data} />
      <DownloadTotal history={data} />
    </div>
  );
}

function DownloadDelta({ history }: { history: DownloadSummary['history'] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const data = history.slice(1).map((p, i) => ({
    observedAt: p.observedAt,
    previousAt: history[i].observedAt,
    change: BigInt(p.total) - BigInt(history[i].total),
  }));
  if (!data.length)
    return (
      <figure className="metric-chart-slot download-growth" aria-label="下载量增量">
        <figcaption className="metric-chart-heading">
          <h3>下载量增量</h3>
          <p>每次采集与上一次采集的差值 · 首次记录作为对比基准</p>
        </figcaption>
        <p className="metric-chart-plot small-empty">
          {history.length
            ? '需要至少两次采集，才能对比下载量增量。'
            : '所选时间范围内暂无下载量记录，等待自动采集后查看。'}
        </p>
      </figure>
    );
  const min = data.reduce((n, p) => (p.change < n ? p.change : n), 0n);
  const max = data.reduce((n, p) => (p.change > n ? p.change : n), 0n);
  const span = max - min;
  const ticks = [...new Set([min, min / 2n, 0n, max / 2n, max])];
  const first = history[0].observedAt;
  const duration = history[history.length - 1].observedAt - first;
  const x = (at: number) => (duration ? 104 + ((at - first) / duration) * 348 : 278);
  const y = (value: bigint) => (span ? 196 - Number(((value - min) * 164000n) / span) / 1000 : 114);
  const width = Math.max(
    1,
    Math.min(24, ...data.map((p) => (x(p.observedAt) - x(p.previousAt)) * 0.7)),
  );
  const active = Math.min(selected ?? data.length - 1, data.length - 1);
  const detail = (i: number) => {
    const p = data[i];
    return `${downloadTime(p.previousAt)} → ${downloadTime(p.observedAt)} · 较上次 ${p.change > 0n ? '+' : ''}${p.change.toLocaleString('zh-CN')} 次下载`;
  };
  return (
    <figure className="metric-chart-slot download-growth" aria-label="下载量增量">
      <figcaption className="metric-chart-heading">
        <h3>下载量增量</h3>
        <p>每次采集与上一次采集的差值 · 首次记录作为对比基准</p>
      </figcaption>
      <div className="metric-chart-plot download-growth-scroll">
        <svg className="trend-svg" viewBox="0 0 480 250" role="img" aria-label="下载量增量图">
          {ticks.map((tick) => (
            <g key={String(tick)}>
              <line
                x1="104"
                x2="452"
                y1={y(tick)}
                y2={y(tick)}
                className="grid-line"
                style={tick === 0n ? { strokeWidth: 2, strokeDasharray: 'none' } : undefined}
              />
              <text x="92" y={y(tick) + 5} textAnchor="end" className="axis-label">
                {axisNumber(tick)}
              </text>
            </g>
          ))}
          {data.map((p, i) => (
            <rect
              key={p.observedAt}
              x={x(p.observedAt) - width / 2}
              y={p.change === 0n ? y(0n) - 1 : Math.min(y(0n), y(p.change))}
              width={width}
              height={p.change === 0n ? 2 : Math.abs(y(p.change) - y(0n))}
              fill={
                p.change < 0n
                  ? 'var(--chart-negative, #d28d88)'
                  : p.change > 0n
                    ? 'var(--chart-positive, #5fcfa4)'
                    : 'var(--chart-neutral, #81858d)'
              }
              opacity={i === active ? 1 : 0.65}
            >
              <title>{detail(i)}</title>
            </rect>
          ))}
          <DownloadTimeAxis first={first} duration={duration} />
        </svg>
      </div>
      <div className="metric-chart-footer">
        <label className="download-growth-control">
          <span>查看采集时间点</span>
          <input
            type="range"
            aria-label="下载量增量采集时间"
            min="0"
            max={data.length - 1}
            value={active}
            onChange={(event) => setSelected(Number(event.target.value))}
          />
        </label>
        <p className="download-chart-detail" aria-live="polite">
          {detail(active)}
        </p>
      </div>
    </figure>
  );
}

function DownloadTimeAxis({ first, duration }: { first: number; duration: number }) {
  return (duration ? [0, 0.5, 1] : [0.5]).map((fraction) => (
    <text
      key={fraction}
      x={104 + fraction * 348}
      y="231"
      textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
      className={`axis-label${duration && fraction === 0.5 ? ' download-time-middle' : ''}`}
    >
      {downloadTime(first + duration * fraction)}
    </text>
  ));
}

function DownloadTotal({ history: data }: { history: DownloadSummary['history'] }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!data.length)
    return (
      <figure className="metric-chart-slot download-growth" aria-label="总下载量增长">
        <figcaption className="metric-chart-heading">
          <h3>总下载量增长</h3>
          <p>所选时间范围内的累计下载量</p>
        </figcaption>
        <p className="metric-chart-plot small-empty">
          所选时间范围内暂无下载量记录，等待自动采集后查看。
        </p>
      </figure>
    );
  const values = data.map((p) => BigInt(p.total));
  const min = values.reduce((a, b) => (a < b ? a : b));
  const max = values.reduce((a, b) => (a > b ? a : b));
  const span = max - min;
  const offsetAxis = span > 0n && axisNumber(min) === axisNumber(max);
  const ticks = span ? [...new Set([0n, span / 4n, span / 2n, (span * 3n) / 4n, span])] : [0n];
  const first = data[0].observedAt;
  const duration = data[data.length - 1].observedAt - first;
  const point = (i: number) => [
    duration ? 104 + ((data[i].observedAt - first) / duration) * 348 : 278,
    span ? 196 - Number(((values[i] - min) * 164000n) / span) / 1000 : 114,
  ];
  const active = Math.min(selected ?? data.length - 1, data.length - 1);
  const line = data.map((_, i) => `${i ? 'L' : 'M'}${point(i).join(',')}`).join(' ');
  return (
    <figure className="metric-chart-slot download-growth" aria-label="总下载量增长">
      <figcaption className="metric-chart-heading">
        <h3>总下载量增长</h3>
        <p>
          所选时间范围内的累计下载量
          {offsetAxis ? ` · 纵轴显示相对 ${downloadNumber(String(min))} 次的增量` : ''}
        </p>
      </figcaption>
      <div className="metric-chart-plot download-growth-scroll">
        <svg className="trend-svg" viewBox="0 0 480 250" role="img" aria-label="总下载量增长图">
          {ticks.map((tick) => {
            const y = span ? 196 - Number((tick * 164000n) / span) / 1000 : 114;
            return (
              <g key={String(tick)}>
                <line x1="104" x2="452" y1={y} y2={y} className="grid-line" />
                <text x="92" y={y + 5} textAnchor="end" className="axis-label">
                  {offsetAxis ? `+${axisNumber(tick)}` : axisNumber(min + tick)}
                </text>
              </g>
            );
          })}
          <path
            d={line}
            fill="none"
            stroke="var(--chart-primary, #5fcfa4)"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {data.map((p, i) => (
            <circle
              key={p.observedAt}
              cx={point(i)[0]}
              cy={point(i)[1]}
              className="chart-point"
              r={i === active ? 5 : data.length < 10 ? 4 : 3}
              opacity={i === active || data.length < 10 || i === 0 ? 1 : 0}
              fill="var(--chart-primary, #5fcfa4)"
              stroke="var(--surface, #1b1b1d)"
              strokeWidth="1.5"
            >
              <title>
                {downloadTime(p.observedAt)} · {downloadNumber(p.total)} 次下载
              </title>
            </circle>
          ))}
          <DownloadTimeAxis first={first} duration={duration} />
        </svg>
      </div>
      <div className="metric-chart-footer">
        {data.length > 1 ? (
          <label className="download-growth-control">
            <span>查看采集时间点</span>
            <input
              type="range"
              aria-label="下载量采集时间"
              min="0"
              max={data.length - 1}
              value={active}
              onChange={(event) => setSelected(Number(event.target.value))}
            />
          </label>
        ) : (
          <p className="field-note">已有 1 次采集，下一次采集后显示增长趋势。</p>
        )}
        <p className="download-chart-detail" aria-live="polite">
          {downloadTime(data[active].observedAt)} · {downloadNumber(data[active].total)} 次下载
        </p>
      </div>
    </figure>
  );
}

export function DownloadComparison({
  points,
  label,
  limit = 12,
}: {
  points: DownloadPoint[];
  label: string;
  limit?: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const known = points.filter((p) => valueOf(p.value) !== null);
  const shown = known.slice(0, limit);
  const max = shown.reduce((n, p) => {
    const v = BigInt(p.value!);
    return v > n ? v : n;
  }, 0n);
  const active = shown.find((p) => p.id === selected);
  return (
    <figure className="download-chart" aria-label={label}>
      <figcaption>
        <h3>{label}</h3>
        <p>按产物比较累计下载量 · 选择条目查看明细</p>
      </figcaption>
      {!known.length ? (
        <p className="small-empty">暂无已知下载量，产物数据读取成功后显示对比</p>
      ) : (
        <>
          <div className="download-bars" role="list">
            {shown.map((p) => {
              const width = max === 0n ? 0 : Number((BigInt(p.value!) * 10000n) / max) / 100;
              return (
                <div role="listitem" key={p.id}>
                  <button
                    className="download-bar-row"
                    aria-label={`${p.label}，累计下载 ${downloadNumber(p.value)}`}
                    aria-pressed={selected === p.id}
                    onClick={() => setSelected(selected === p.id ? null : p.id)}
                  >
                    <span className="download-bar-label" title={p.label}>
                      {p.label}
                    </span>
                    <strong>{downloadNumber(p.value)}</strong>
                    <svg viewBox="0 0 100 7" preserveAspectRatio="none" aria-hidden="true">
                      <rect width="100" height="7" rx="1" fill="var(--chart-track, #303135)" />
                      <rect
                        width={width}
                        height="7"
                        rx="1"
                        fill={
                          selected === p.id || BigInt(p.value!) === max
                            ? 'var(--chart-primary, #5fcfa4)'
                            : 'var(--chart-neutral, #81858d)'
                        }
                      />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
          <p className="download-chart-detail" aria-live="polite">
            {active
              ? `${active.label} · ${downloadNumber(active.value)} 次下载`
              : `显示 ${shown.length} 项累计下载量`}
          </p>
        </>
      )}
      {known.length > limit && (
        <p className="field-note">
          图中展示前 {limit} 项，共 {known.length} 项已知数据
        </p>
      )}
      {known.length < points.length && (
        <p className="field-note">{points.length - known.length} 项下载量未知，未绘制为 0。</p>
      )}
    </figure>
  );
}

export function DownloadDistribution({ points }: { points: DownloadPoint[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!points.length || points.some((p) => valueOf(p.value) === null))
    return (
      <figure className="download-chart" aria-label="产物下载量占比分布">
        <figcaption>
          <h3>产物下载量占比</h3>
        </figcaption>
        <p className="small-empty">所有产物的下载量已知后显示占比</p>
      </figure>
    );
  const sorted = [...points].sort((a, b) =>
    BigInt(a.value!) === BigInt(b.value!)
      ? a.label.localeCompare(b.label)
      : BigInt(a.value!) > BigInt(b.value!)
        ? -1
        : 1,
  );
  const total = sorted.reduce((n, p) => n + BigInt(p.value!), 0n);
  const segments = sorted.slice(0, 7);
  if (sorted.length > 7)
    segments.push({
      id: 'other-assets',
      label: `其他 ${sorted.length - 7} 项产物`,
      value: String(sorted.slice(7).reduce((n, p) => n + BigInt(p.value!), 0n)),
    });
  const percent = (value: string) =>
    total === 0n ? 0 : Number((BigInt(value) * 1000n) / total) / 10;
  let start = 0;
  const active = segments.find((p) => p.id === selected);
  return (
    <figure className="download-chart" aria-label="产物下载量占比分布">
      <figcaption>
        <h3>产物下载量占比</h3>
        <p>累计 {downloadNumber(String(total))} 次下载 · 点击图例查看</p>
      </figcaption>
      <div className="download-distribution stacked">
        <svg viewBox="0 0 600 32" role="img" aria-label="产物下载量占比图">
          <rect width="600" height="32" rx="4" fill="var(--chart-track, #303135)" />
          {segments.map((p, i) => {
            const share = total === 0n ? 0 : Number((BigInt(p.value!) * 1000000n) / total) / 10000;
            const offset = start;
            start += share;
            return (
              <rect
                key={p.id}
                x={offset * 6}
                y="0"
                width={share * 6}
                height="32"
                fill={colors[i]}
                opacity={active && active.id !== p.id ? 0.35 : 1}
              >
                <title>
                  {p.label} · {downloadNumber(p.value)} 次 · {percent(p.value!)}%
                </title>
              </rect>
            );
          })}
        </svg>
        <div className="download-legend">
          {segments.map((p, i) => (
            <button
              key={p.id}
              aria-pressed={selected === p.id}
              onClick={() => setSelected(selected === p.id ? null : p.id)}
            >
              <svg width="10" height="10" aria-hidden="true">
                <circle cx="5" cy="5" r="4" fill={colors[i]} />
              </svg>
              <span title={p.label}>{p.label}</span>
              <strong>{percent(p.value!)}%</strong>
            </button>
          ))}
        </div>
      </div>
      <p className="download-chart-detail" aria-live="polite">
        {active
          ? `${active.label} · ${downloadNumber(active.value)} 次下载`
          : '所有产物的当前累计下载量分布'}
      </p>
    </figure>
  );
}
