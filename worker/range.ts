import { AppError, nowSeconds } from './types';
import { localDay, localMidnight } from './time';
import type { ReleaseBoundary, StatisticsRange } from '../shared/types';
export async function statisticsRange(
  db: D1Database,
  url: URL,
  project: string | null,
): Promise<StatisticsRange> {
  const mode = url.searchParams.get('range') || 'days';
  const now = nowSeconds();
  let since: number;
  let until = now + 1;
  let from: ReleaseBoundary | null = null;
  let to: ReleaseBoundary | null = null;
  const days = Number(url.searchParams.get('days') || 30);
  if (mode === 'releases') {
    if (!project) throw new AppError(400, 'Release 区间必须选择单个项目。');
    const a = Number(url.searchParams.get('fromRelease'));
    const b = Number(url.searchParams.get('toRelease'));
    if (!Number.isSafeInteger(a) || a <= 0 || !Number.isSafeInteger(b) || b <= 0 || a === b)
      throw new AppError(400, '请选择两个不同的 Release。');
    const rows = await db
      .prepare(
        'SELECT github_id,tag_name,published_at,prerelease FROM releases WHERE project_id=? AND github_id IN (?,?) AND published_at IS NOT NULL AND draft=0',
      )
      .bind(project, a, b)
      .all<ReleaseBoundary>();
    from = rows.results.find((r) => r.github_id === a) ?? null;
    to = rows.results.find((r) => r.github_id === b) ?? null;
    if (!from || !to) throw new AppError(400, '所选 Release 不属于该项目或尚未发布。');
    if (from.published_at >= to.published_at)
      throw new AppError(400, '结束 Release 的发布时间必须晚于起始 Release。');
    if (to.published_at > now) throw new AppError(400, '不能选择尚未到达的发布时间。');
    since = from.published_at;
    until = to.published_at;
  } else {
    if (mode !== 'days' || ![7, 30, 90].includes(days))
      throw new AppError(400, '统计时间范围无效。');
    since = localMidnight(now) - (days - 1) * 86400;
  }
  const span = Math.floor((localMidnight(until - 1) - localMidnight(since)) / 86400) + 1;
  const bucketDays = Math.max(1, Math.ceil(span / 90));
  const coverage = project
    ? await db
        .prepare('SELECT first_received_at FROM webhook_connections WHERE project_id=?')
        .bind(project)
        .first<number | null>('first_received_at')
    : null;
  return {
    mode: mode as StatisticsRange['mode'],
    since,
    until,
    bucketDays,
    days: span,
    fromRelease: from,
    toRelease: to,
    label: from && to ? `${from.tag_name} → ${to.tag_name}` : `近 ${days} 天`,
    coverageStart: coverage ?? null,
    partial: !!project && (coverage === null || since < coverage),
    startDay: localDay(since),
    endDay: localDay(until - 1),
  };
}
