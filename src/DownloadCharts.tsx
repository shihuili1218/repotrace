import { useState } from 'react';

export interface DownloadPoint {
  id: string;
  label: string;
  value: string | null;
}
const colors = [
  '#5369ef',
  '#38a686',
  '#e4a94f',
  '#a07bcd',
  '#e17994',
  '#4aa5bb',
  '#8a9462',
  '#9ba4bd',
];
const valueOf = (value: string | null) =>
  value !== null && /^\d+$/.test(value) ? BigInt(value) : null;
export const downloadNumber = (value: string | null | undefined) =>
  value == null ? '—' : /^\d+$/.test(value) ? BigInt(value).toLocaleString('zh-CN') : '—';

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
        <p>当前累计值 · 点击条目查看完整名称和数字</p>
      </figcaption>
      {!known.length ? (
        <p className="small-empty">暂无可绘制的下载量，请在后台刷新成功后再次读取缓存。</p>
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
                      <rect width="100" height="7" rx="3.5" fill="#edf0fa" />
                      <rect width={width} height="7" rx="3.5" fill="#5369ef" />
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
          图中展示前 {limit} 项，共 {known.length} 项已知数据。
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
        <p className="small-empty">下载量数据完整后显示占比。</p>
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
      <div className="download-distribution">
        <svg viewBox="0 0 160 160" role="img" aria-label="产物下载量占比图">
          <circle cx="80" cy="80" r="59" fill="none" stroke="#edf0fa" strokeWidth="16" />
          {segments.map((p, i) => {
            const share = percent(p.value!);
            const offset = -start;
            start += share;
            return (
              <circle
                key={p.id}
                cx="80"
                cy="80"
                r="59"
                pathLength="100"
                fill="none"
                stroke={colors[i]}
                strokeWidth={selected === p.id ? 20 : 16}
                strokeDasharray={`${share} ${100 - share}`}
                strokeDashoffset={offset}
                transform="rotate(-90 80 80)"
                opacity={active && active.id !== p.id ? 0.3 : 1}
              >
                <title>
                  {p.label} · {downloadNumber(p.value)} 次 · {share}%
                </title>
              </circle>
            );
          })}
          <text x="80" y="78" textAnchor="middle" className="download-donut-value">
            {active ? percent(active.value!) : total === 0n ? 0 : 100}%
          </text>
          <text x="80" y="100" textAnchor="middle" className="axis-label">
            {active ? '所选产物占比' : '全部产物'}
          </text>
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
