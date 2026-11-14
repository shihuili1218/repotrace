import { expect, test } from '@playwright/test';
import type { MonitorData, WorkItem } from '../shared/types';
import { installDesignFixture } from './design-fixture';

test('only marks open non-draft PRs without a recorded review as awaiting review', async ({
  page,
}) => {
  await installDesignFixture(page);
  const at = Date.UTC(2026, 10, 14, 8) / 1000;
  const examples: {
    title: string;
    state: WorkItem['state'];
    draft: number;
    review: WorkItem['review_state'];
    expected: string;
  }[] = [
    { title: 'Ready for review', state: 'open', draft: 0, review: null, expected: '待评审' },
    { title: 'Draft work', state: 'open', draft: 1, review: null, expected: '无已记录评审' },
    { title: 'Merged work', state: 'merged', draft: 0, review: null, expected: '无已记录评审' },
    { title: 'Closed work', state: 'closed', draft: 0, review: null, expected: '无已记录评审' },
    { title: 'Approved work', state: 'open', draft: 0, review: 'approved', expected: '已批准' },
    { title: 'Dismissed review', state: 'open', draft: 0, review: 'dismissed', expected: '已撤销' },
  ];
  const items: WorkItem[] = examples.map((example, index) => ({
    project_id: 'rssh',
    github_id: 1000 + index,
    kind: 'pull_request',
    full_name: 'shihuili1218/rssh',
    number: 51 + index,
    title: example.title,
    author_id: 100,
    author_login: 'sarah-chen',
    state: example.state,
    draft: example.draft,
    labels: [],
    created_at: at - 86400,
    updated_at: at,
    closed_at: example.state === 'closed' || example.state === 'merged' ? at : null,
    merged_at: example.state === 'merged' ? at : null,
    first_seen_at: at - 86400,
    first_reply_at: null,
    review_state: example.review,
    reviewed_at: example.review ? at : null,
  }));
  await page.route('**/api/monitoring?*', (route) => {
    if (new URL(route.request().url()).searchParams.get('type') !== 'pull_requests')
      return route.fallback();
    const data: MonitorData = {
      type: 'pull_requests',
      stars: [],
      forks: [],
      releases: [],
      items,
      total: items.length,
      page: 1,
      labels: [],
      contributors: [],
    };
    return route.fulfill({ json: data });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '项目数据', exact: true }).click();
  await page.getByRole('tab', { name: 'Pull Request', exact: true }).click();
  const rows = page.locator('.monitor-table tbody tr');
  await expect(rows).toHaveCount(examples.length);
  for (const example of examples) {
    const row = rows.filter({ hasText: example.title });
    await expect(row.getByRole('cell').nth(3)).toHaveText(example.expected);
  }
  await expect(rows.getByText('待评审', { exact: true })).toHaveCount(1);
});
