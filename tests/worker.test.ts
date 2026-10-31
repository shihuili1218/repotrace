/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as bindings } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { initDB, migrations } from '../worker/db';
import { getWebhookCredentials } from '../worker/webhook-secrets';
import { latestDue, localDay, summarizeDue, summarizePeriod } from '../worker/summaries';
import { parseRepository } from '../worker/projects';
import { nowSeconds, type Env } from '../worker/types';
import type { Dashboard, WebhookConfig } from '../shared/types';

const env = bindings as unknown as Env;
const password = 'a-secure-test-password-2026';
const origin = 'https://repotrace.test';
async function send(request: Request, environment = env) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, environment, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
async function request(
  path: string,
  method = 'GET',
  data?: unknown,
  cookie?: string,
  extra?: Record<string, string>,
  environment = env,
) {
  return send(
    new Request(`${origin}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
      body: method !== 'GET' ? JSON.stringify(data ?? {}) : undefined,
    }),
    environment,
  );
}
async function setup() {
  const response = await request('/auth/setup', 'POST', { password });
  expect(response.status).toBe(201);
  return response.headers.get('Set-Cookie')!.split(';')[0];
}
async function add(session: string, repository = 'owner/repo') {
  const response = await request('/repositories', 'POST', { repository }, session);
  expect(response.status).toBe(201);
  return await response.json<WebhookConfig & { secret: string }>();
}
async function dashboard(session: string, query = '') {
  return (await request(`/dashboard${query}`, 'GET', undefined, session)).json<Dashboard>();
}
async function signed(
  config: WebhookConfig,
  event = 'ping',
  patch: Record<string, unknown> = {},
  delivery = crypto.randomUUID(),
  at = nowSeconds(),
) {
  const payload = JSON.stringify({
    repository: {
      id: 100,
      full_name: 'owner/repo',
      description: 'A project',
      language: 'TypeScript',
      stargazers_count: 10,
    },
    ...(event === 'star'
      ? {
          action: 'created',
          sender: { id: 1, login: 'octocat' },
          starred_at: '2026-10-30T12:00:00Z',
        }
      : {}),
    ...patch,
  });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(config.secret!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = [
    ...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(at * 1000);
  try {
    return await send(
      new Request(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${signature}`,
          'X-GitHub-Event': event,
          'X-GitHub-Delivery': delivery,
        },
        body: payload,
      }),
    );
  } finally {
    clock.mockRestore();
  }
}
async function scalar(sql: string, ...params: unknown[]) {
  return env.DB.prepare(sql)
    .bind(...params)
    .first<number>('count');
}
beforeEach(async () => {
  await initDB(env.DB);
  await env.DB.batch(
    [
      'DELETE FROM projects',
      'DELETE FROM sessions',
      'DELETE FROM admin',
      'DELETE FROM login_limits',
      "DELETE FROM monitor_settings WHERE key!='daily_hour'",
      "UPDATE monitor_settings SET value='23' WHERE key='daily_hour'",
    ].map((sql) => env.DB.prepare(sql)),
  );
});
afterEach(() => vi.restoreAllMocks());
describe('private admin workspace', () => {
  it('exposes only bootstrap state before login and rejects cross-origin writes', async () => {
    expect(await (await request('/auth/status')).json()).toEqual({
      initialized: false,
      authenticated: false,
      setupProtected: false,
    });
    for (const endpoint of ['/dashboard', '/settings']) {
      const r = await request(endpoint);
      expect(r.status).toBe(401);
      expect(r.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(
      (
        await request('/auth/setup', 'POST', { password }, undefined, {
          Origin: 'https://evil.test',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/auth/setup', 'POST', { password }, undefined, {
          'Content-Type': 'text/plain',
        })
      ).status,
    ).toBe(415);
    expect((await request('/auth/setup', 'POST', { password: 'short' })).status).toBe(400);
  });

  it('initializes once, stores only password/session hashes, and logs out server-side', async () => {
    const session = await setup();
    expect((await request('/auth/setup', 'POST', { password })).status).toBe(409);
    const row = await env.DB.prepare('SELECT * FROM admin').first<{ hash: string; salt: string }>();
    expect(row?.hash).toHaveLength(64);
    expect(row?.salt).toHaveLength(64);
    expect(row?.hash).not.toBe(password);
    const stored = await env.DB.prepare('SELECT token_hash FROM sessions').first<{
      token_hash: string;
    }>();
    expect(session).not.toContain(stored!.token_hash);
    expect((await request('/dashboard', 'GET', undefined, session)).status).toBe(200);
    expect(
      (await request('/auth/logout', 'POST', {}, session)).headers.get('Set-Cookie'),
    ).toContain('Max-Age=0');
    expect((await request('/dashboard', 'GET', undefined, session)).status).toBe(401);
    expect((await request('/auth/login', 'POST', { password: 'wrong' })).status).toBe(401);
    const login = await request('/auth/login', 'POST', { password });
    expect(login.status).toBe(200);
    expect(login.headers.get('Set-Cookie')).toMatch(
      /HttpOnly; SameSite=Strict; Max-Age=604800; Secure/,
    );
  });

  it('invalidates other sessions when the password changes', async () => {
    const first = await setup();
    const second = (await request('/auth/login', 'POST', { password })).headers
      .get('Set-Cookie')!
      .split(';')[0];
    const changed = await request(
      '/auth/password',
      'POST',
      { currentPassword: password, password: `${password}-new` },
      first,
    );
    expect(changed.status).toBe(200);
    expect((await request('/dashboard', 'GET', undefined, first)).status).toBe(401);
    expect((await request('/dashboard', 'GET', undefined, second)).status).toBe(401);
    expect(
      (
        await request(
          '/dashboard',
          'GET',
          undefined,
          changed.headers.get('Set-Cookie')!.split(';')[0],
        )
      ).status,
    ).toBe(200);
    expect((await request('/auth/login', 'POST', { password })).status).toBe(401);
  });

  it('limits password attempts and honors an optional first-run setup token', async () => {
    const protectedEnv = { ...env, SETUP_TOKEN: 'deployment-setup-code' };
    expect(
      (await request('/auth/setup', 'POST', { password }, undefined, undefined, protectedEnv))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          '/auth/setup',
          'POST',
          { password, setupToken: 'deployment-setup-code' },
          undefined,
          undefined,
          protectedEnv,
        )
      ).status,
    ).toBe(201);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await request('/auth/login', 'POST', { password: 'bad' }, undefined, {
            'CF-Connecting-IP': '192.0.2.10',
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await request('/auth/login', 'POST', { password }, undefined, {
          'CF-Connecting-IP': '192.0.2.10',
        })
      ).status,
    ).toBe(429);
  });
});

describe('project setup without outgoing GitHub requests', () => {
  it('creates an unverified project and reveals its secret once, stored encrypted', async () => {
    const session = await setup();
    const outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No outgoing request allowed'));
    const config = await add(session);
    expect(config.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(config.url).toBe(`${origin}/hooks/github/${config.id}`);
    expect((await getWebhookCredentials(env, config.id))?.secret).toBe(config.secret);
    const stored = await env.DB.prepare('SELECT * FROM webhook_connections').first<{
      ciphertext: string;
    }>();
    expect(stored?.ciphertext).not.toContain(config.secret);
    const get = await request(`/repositories/${config.id}/webhook`, 'GET', undefined, session);
    expect(await get.text()).not.toContain(config.secret);
    const data = await dashboard(session);
    expect(JSON.stringify(data)).not.toContain(config.secret);
    expect(data.repositories[0]).toMatchObject({
      github_id: null,
      current_total: null,
      webhookConfigured: true,
      last_received_at: null,
    });
    expect(outbound).not.toHaveBeenCalled();
  });
  it('rejects duplicate projects, invalid names, missing sessions and cross-origin changes', async () => {
    const session = await setup();
    await add(session);
    expect(
      (await request('/repositories', 'POST', { repository: 'OWNER/REPO' }, session)).status,
    ).toBe(409);
    expect(
      (await request('/repositories', 'POST', { repository: 'https://evil.example/repo' }, session))
        .status,
    ).toBe(400);
    expect((await request('/repositories', 'POST', { repository: 'x/y' })).status).toBe(401);
    expect(
      (
        await request('/repositories', 'POST', { repository: 'x/y' }, session, {
          Origin: 'https://evil.test',
        })
      ).status,
    ).toBe(403);
    expect((await request('/repositories/missing/webhook', 'GET', undefined, session)).status).toBe(
      404,
    );
  });
  it('accepts only GitHub repo formats', () => {
    expect(parseRepository(' https://github.com/owner/repo.git/ ')).toBe('owner/repo');
    for (const input of [
      'https://evil.test/o/r',
      'o/r/../../x',
      'o/..',
      'o/r?x',
      'o/r#x',
      'git@github.com:o/r',
      null,
    ])
      expect(() => parseRepository(input)).toThrow();
  });
  it('encrypts each project with project-bound associated data', async () => {
    const session = await setup();
    const [a, b] = await Promise.all([add(session), add(session, 'other/project')]);
    expect((await getWebhookCredentials(env, a.id))?.secret).toBe(a.secret);
    expect((await getWebhookCredentials(env, b.id))?.secret).toBe(b.secret);
    await env.DB.prepare(
      'UPDATE webhook_connections SET ciphertext=(SELECT ciphertext FROM webhook_connections WHERE project_id=?) WHERE project_id=?',
    )
      .bind(a.id, b.id)
      .run();
    await expect(getWebhookCredentials(env, b.id)).rejects.toThrow('无法解密');
  });
  it('removes the retired polling and credential endpoints', async () => {
    const session = await setup();
    const config = await add(session);
    for (const [path, method] of [
      [`/repositories/${config.id}/token`, 'PUT'],
      [`/repositories/${config.id}/sync`, 'POST'],
      ['/snapshots/old/continue', 'POST'],
      ['/snapshots/old/retry', 'POST'],
    ])
      expect((await request(path, method, {}, session)).status).toBe(404);
  });
});

describe('signed GitHub deliveries', () => {
  it('accepts public signed ping, binds repo identity and preserves a zero count', async () => {
    const session = await setup();
    const config = await add(session);
    expect(
      (
        await signed(config, 'ping', {
          repository: { id: 100, full_name: 'owner/repo', stargazers_count: 0 },
        })
      ).status,
    ).toBe(200);
    const data = await dashboard(session);
    expect(data.repositories[0]).toMatchObject({ github_id: 100, current_total: 0 });
    expect(data.repositories[0].last_received_at).toBeTypeOf('number');
    expect(data.summaries[0]).toMatchObject({ kind: 'baseline', total: 0, added: 0, removed: 0 });
  });
  it('rejects missing/wrong signatures and changes to the signed bytes without writing data', async () => {
    const config = await add(await setup());
    expect((await send(new Request(config.url, { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await signed({ ...config, secret: 'wrong' })).status).toBe(401);
    expect((await send(new Request(config.url, { method: 'GET' }))).status).toBe(405);
    expect(await scalar('SELECT COUNT(*) AS count FROM webhook_deliveries')).toBe(0);
    expect((await env.DB.prepare('SELECT github_id FROM projects').first())?.github_id).toBeNull();
  });
  it('records created and deleted users and uses the latest reported repository total', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config);
    await signed(config, 'star');
    await signed(config, 'star', {
      action: 'deleted',
      sender: { id: 2, login: 'second-user' },
      starred_at: null,
      repository: { id: 100, full_name: 'owner/repo', stargazers_count: 9 },
    });
    const data = await dashboard(session);
    expect(data.eventCounts).toEqual({ added: 1, removed: 1 });
    expect(data.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 1, kind: 'added' }),
        expect.objectContaining({ user_id: 2, kind: 'removed', starred_at: null }),
      ]),
    );
    expect(data.repositories[0].current_total).toBe(9);
  });
  it('deduplicates concurrent redeliveries atomically and never rewinds a newer total', async () => {
    const session = await setup();
    const config = await add(session);
    const delivery = crypto.randomUUID();
    await Promise.all(Array.from({ length: 4 }, () => signed(config, 'star', {}, delivery)));
    await signed(config, 'ping', {
      repository: { id: 100, full_name: 'owner/repo', stargazers_count: 11 },
    });
    await signed(config, 'star', {}, delivery);
    const data = await dashboard(session);
    expect(data.changeTotal).toBe(1);
    expect(data.repositories[0].current_total).toBe(11);
    expect(await scalar('SELECT COUNT(*) AS count FROM webhook_deliveries')).toBe(2);
  });
  it('ignores signed unsupported events, rejects malformed stars and unbound repository mismatches', async () => {
    const config = await add(await setup());
    expect((await signed(config, 'push')).status).toBe(200);
    expect((await signed(config, 'star', { action: 'edited' })).status).toBe(400);
    expect((await signed(config, 'star', { sender: { id: 1, login: '../evil' } })).status).toBe(
      400,
    );
    expect(
      (
        await signed(config, 'ping', {
          repository: { id: 101, full_name: 'other/repo', stargazers_count: 1 },
        })
      ).status,
    ).toBe(409);
    expect(await scalar('SELECT COUNT(*) AS count FROM webhook_deliveries')).toBe(0);
  });
  it('accepts renames only for the bound GitHub repository ID', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config);
    expect(
      (
        await signed(config, 'ping', {
          repository: { id: 101, full_name: 'owner/repo', stargazers_count: 1 },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await signed(config, 'ping', {
          repository: { id: 100, full_name: 'owner/renamed', stargazers_count: 12 },
        })
      ).status,
    ).toBe(200);
    expect((await dashboard(session)).repositories[0].full_name).toBe('owner/renamed');
  });
  it('acknowledges paused deliveries without recording changes or updating total, then resumes', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config);
    await request(`/repositories/${config.id}`, 'PATCH', { enabled: false }, session);
    const response = await signed(config, 'star', {
      repository: { id: 100, full_name: 'owner/repo', stargazers_count: 999 },
    });
    expect(await response.json()).toMatchObject({ ok: true, paused: true });
    expect((await dashboard(session)).repositories[0].current_total).toBe(10);
    expect(await scalar('SELECT COUNT(*) AS count FROM star_events')).toBe(0);
    await request(`/repositories/${config.id}`, 'PATCH', { enabled: true }, session);
    await signed(config, 'star');
    expect(await scalar('SELECT COUNT(*) AS count FROM star_events')).toBe(1);
  });
  it('rotates secrets, resets connection status and rejects the old signature', async () => {
    const session = await setup();
    const config = await add(session);
    const delivery = crypto.randomUUID();
    await signed(config, 'ping', {}, delivery);
    const replacement = await (
      await request(`/repositories/${config.id}/webhook`, 'POST', {}, session)
    ).json<WebhookConfig>();
    expect(replacement.secret).not.toBe(config.secret);
    expect((await dashboard(session)).repositories[0].last_received_at).toBeNull();
    expect((await signed(config)).status).toBe(401);
    expect((await signed(replacement, 'ping', {}, delivery)).status).toBe(200);
    expect((await dashboard(session)).repositories[0].last_received_at).not.toBeNull();
  });
  it('deletes the project, its ciphertext, events and summaries with no orphan records', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config, 'star');
    expect((await request(`/repositories/${config.id}`, 'DELETE', {}, session)).status).toBe(200);
    for (const table of [
      'projects',
      'webhook_connections',
      'webhook_deliveries',
      'star_events',
      'summaries',
      'summary_changes',
    ])
      expect(await scalar(`SELECT COUNT(*) AS count FROM ${table}`)).toBe(0);
    expect((await signed(config)).status).toBe(401);
  });
});

describe('nightly summaries and charts', () => {
  const end = latestDue(nowSeconds(), 23);
  const at = end - 3600; // 22:00 Shanghai, immediately before the last daily cutoff
  it('computes net users by stable ID, cancels opposite actions and keeps latest usernames', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config, 'ping', {}, crypto.randomUUID(), at);
    for (const [offset, id, login, action] of [
      [1, 1, 'original', 'created'],
      [2, 1, 'renamed', 'deleted'],
      [3, 2, 'second', 'deleted'],
      [4, 2, 'second', 'created'],
      [5, 3, 'third-old', 'created'],
      [6, 3, 'third-new', 'created'],
      [7, 4, 'fourth', 'deleted'],
    ] as const)
      await signed(
        config,
        'star',
        { action, sender: { id, login } },
        crypto.randomUUID(),
        at + offset,
      );
    await summarizeDue(env.DB, end - 1);
    expect(await scalar("SELECT COUNT(*) AS count FROM summaries WHERE kind='daily'")).toBe(0);
    await summarizeDue(env.DB, end);
    await summarizeDue(env.DB, end + 60);
    const summary = await env.DB.prepare("SELECT * FROM summaries WHERE kind='daily'").first<{
      id: string;
      added: number;
      removed: number;
      event_count: number;
      period_start: number;
      period_end: number;
    }>();
    expect(summary).toMatchObject({
      added: 1,
      removed: 1,
      event_count: 7,
      period_start: at,
      period_end: end,
    });
    const changes = await env.DB.prepare('SELECT * FROM summary_changes WHERE summary_id=?')
      .bind(summary!.id)
      .all();
    expect(changes.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 3, login: 'third-new', kind: 'added' }),
        expect.objectContaining({ user_id: 4, kind: 'removed' }),
      ]),
    );
    expect(changes.results).toHaveLength(2);
    expect(await scalar("SELECT COUNT(*) AS count FROM summaries WHERE kind='daily'")).toBe(1);
  });
  it('uses half-open windows, catches up quiet days and carries forward the last reported total', async () => {
    const config = await add(await setup());
    await signed(config, 'ping', {}, crypto.randomUUID(), at);
    await signed(config, 'star', {}, crypto.randomUUID(), end);
    await summarizeDue(env.DB, end + 86400 * 2);
    const list = await env.DB.prepare(
      "SELECT * FROM summaries WHERE kind='daily' ORDER BY period_end",
    ).all();
    expect(list.results).toHaveLength(3);
    expect(list.results.map((s) => s.event_count)).toEqual([0, 1, 0]);
    expect(list.results.map((s) => s.total)).toEqual([10, 10, 10]);
    expect(list.results.map((s) => s.added)).toEqual([0, 1, 0]);
  });
  it('recomputes a boundary window when a received event commits after its first summary', async () => {
    const config = await add(await setup());
    await signed(config, 'ping', {}, crypto.randomUUID(), at);
    await summarizeDue(env.DB, end);
    await signed(config, 'star', {}, crypto.randomUUID(), end - 1);
    await summarizeDue(env.DB, end + 60);
    expect(
      (await env.DB.prepare("SELECT added FROM summaries WHERE kind='daily'").first())?.added,
    ).toBe(1);
  });
  it('preserves continuous windows when the schedule moves and does not summarize before connection', async () => {
    const session = await setup();
    const config = await add(session);
    await summarizeDue(env.DB, end + 86400);
    expect(await scalar('SELECT COUNT(*) AS count FROM summaries')).toBe(0);
    await signed(config, 'ping', {}, crypto.randomUUID(), at);
    await summarizeDue(env.DB, end);
    expect((await request('/settings', 'PATCH', { dailyHour: 22 }, session)).status).toBe(200);
    await signed(config, 'star', {}, crypto.randomUUID(), end + 100);
    await summarizeDue(env.DB, end + 23 * 3600);
    const list = await env.DB.prepare(
      "SELECT * FROM summaries WHERE kind='daily' ORDER BY period_end",
    ).all();
    expect(list.results).toHaveLength(2);
    expect(list.results[1]).toMatchObject({
      period_start: end,
      period_end: end + 23 * 3600,
      added: 1,
    });
  });
  it('uses Beijing cutoff boundaries across midnight and validates settings', async () => {
    expect(localDay(Date.parse('2026-10-30T16:00:00Z') / 1000)).toBe('2026-10-31');
    expect(latestDue(end - 1, 23)).toBe(end - 86400);
    expect(latestDue(end, 23)).toBe(end);
    const session = await setup();
    for (const hour of [-1, 24, 3.5, '22'])
      expect((await request('/settings', 'PATCH', { dailyHour: hour }, session)).status).toBe(400);
  });
  it('paginates and filters live events and summary users without leaking secret data', async () => {
    const session = await setup();
    const config = await add(session);
    for (let id = 1; id <= 33; id++)
      await signed(config, 'star', {
        action: id === 33 ? 'deleted' : 'created',
        sender: { id, login: `user-${id}` },
      });
    const first = await dashboard(session);
    expect(first.changes).toHaveLength(30);
    expect(first.changeTotal).toBe(33);
    expect((await dashboard(session, '?page=2')).changes).toHaveLength(3);
    expect((await dashboard(session, '?kind=removed')).changeTotal).toBe(1);
    await summarizePeriod(env.DB, config.id, nowSeconds() - 10, nowSeconds() + 10);
    const daily = await env.DB.prepare("SELECT id FROM summaries WHERE kind='daily'").first<{
      id: string;
    }>();
    expect((await dashboard(session, `?summary=${daily!.id}&kind=added`)).changeTotal).toBe(32);
    expect((await request('/dashboard?repo=missing', 'GET', undefined, session)).status).toBe(404);
    expect((await request('/dashboard?days=99', 'GET', undefined, session)).status).toBe(400);
  });
  it('runs scheduled summaries with no GitHub calls and reports the cron heartbeat', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config, 'ping', {}, crypto.randomUUID(), at);
    const outgoing = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected network'));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(end * 1000);
    await worker.scheduled({} as ScheduledController, env, createExecutionContext());
    clock.mockRestore();
    expect(outgoing).not.toHaveBeenCalled();
    expect(
      (await env.DB.prepare("SELECT value FROM monitor_settings WHERE key='last_cron_at'").first())
        ?.value,
    ).toBe(String(end));
    expect(await scalar("SELECT COUNT(*) AS count FROM summaries WHERE kind='daily'")).toBe(1);
    const chart = await dashboard(session);
    expect(chart.history.find((row) => row.day === localDay(end))?.total).toBe(10);
  });
});

it('migrates legacy history and admin data, deleting all saved PATs and pending polling jobs', async () => {
  const legacy = (bindings as unknown as { LEGACY_DB: D1Database }).LEGACY_DB;
  await legacy.batch([
    legacy.prepare('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)'),
    ...migrations[0].map((sql) => legacy.prepare(sql)),
    legacy.prepare('INSERT INTO schema_migrations VALUES (1),(2)'),
  ]);
  await legacy.batch([
    legacy.prepare("INSERT INTO admin VALUES (1,'hash','salt',100000)"),
    legacy.prepare(
      "INSERT INTO repositories VALUES ('old',100,'owner/repo','Legacy','TypeScript',1,100)",
    ),
    legacy.prepare(
      'CREATE TABLE repository_tokens(repo_id TEXT PRIMARY KEY,key_id TEXT,ciphertext TEXT,updated_at INTEGER)',
    ),
    legacy.prepare("INSERT INTO repository_tokens VALUES ('old','old-key','old-ciphertext',100)"),
    legacy.prepare("INSERT INTO monitor_settings VALUES ('token_vault_key','old-key')"),
    legacy.prepare(
      "INSERT INTO snapshots(id,repo_id,kind,day,status,total,added,started_at,completed_at) VALUES ('done','old','daily','2026-10-29','complete',12,1,100,200),('pending','old','manual','2026-10-30','collecting',0,0,300,NULL)",
    ),
    legacy.prepare("INSERT INTO star_changes VALUES ('done',1,'octocat','added',NULL)"),
  ]);
  await initDB(legacy);
  await initDB(legacy);
  expect(await legacy.prepare('SELECT hash FROM admin').first('hash')).toBe('hash');
  expect(await legacy.prepare('SELECT COUNT(*) AS count FROM projects').first('count')).toBe(1);
  expect(await legacy.prepare('SELECT * FROM summaries').first()).toMatchObject({
    id: 'done',
    source: 'legacy',
    total: 12,
  });
  expect(await legacy.prepare('SELECT * FROM summary_changes').first()).toMatchObject({
    login: 'octocat',
  });
  const tables = await legacy
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all<{ name: string }>();
  for (const obsolete of [
    'repository_tokens',
    'snapshots',
    'snapshot_members',
    'star_changes',
    'repositories',
  ])
    expect(tables.results.map((t) => t.name)).not.toContain(obsolete);
  expect(
    await legacy.prepare("SELECT value FROM monitor_settings WHERE key='token_vault_key'").first(),
  ).toBeNull();
});

it('verifies the exact raw bytes and bounds oversized bodies even without a Content-Length', async () => {
  const config = await add(await setup());
  const raw = '{"repository":{"id":100,"full_name":"owner/repo","stargazers_count":1}}';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(config.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = [
    ...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  const headers = {
    'X-Hub-Signature-256': `sha256=${signature}`,
    'X-GitHub-Event': 'ping',
    'X-GitHub-Delivery': crypto.randomUUID(),
  };
  // Same parsed JSON, different raw bytes: verification must fail.
  expect(
    (await send(new Request(config.url, { method: 'POST', headers, body: raw + ' ' }))).status,
  ).toBe(401);
  expect(
    (
      await send(
        new Request(config.url, { method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1) }),
      )
    ).status,
  ).toBe(413);
  expect(await scalar('SELECT COUNT(*) AS count FROM webhook_deliveries')).toBe(0);
});

it('rolls back the delivery marker if recording an event fails so the same delivery can be retried', async () => {
  const config = await add(await setup());
  const delivery = crypto.randomUUID();
  await env.DB.prepare(
    "CREATE TRIGGER fail_event BEFORE INSERT ON star_events BEGIN SELECT RAISE(ABORT,'test failure'); END",
  ).run();
  try {
    expect((await signed(config, 'star', {}, delivery)).status).toBe(500);
    expect(await scalar('SELECT COUNT(*) AS count FROM webhook_deliveries')).toBe(0);
  } finally {
    await env.DB.prepare('DROP TRIGGER fail_event').run();
  }
  expect((await signed(config, 'star', {}, delivery)).status).toBe(200);
  expect(await scalar('SELECT COUNT(*) AS count FROM star_events')).toBe(1);
});

it('moving the cutoff later keeps one immutable summary per day and a continuous next window', async () => {
  const session = await setup();
  const config = await add(session);
  const end = latestDue(nowSeconds(), 22);
  const start = end - 3600;
  await request('/settings', 'PATCH', { dailyHour: 22 }, session);
  await signed(config, 'ping', {}, crypto.randomUUID(), start);
  await summarizeDue(env.DB, end);
  await request('/settings', 'PATCH', { dailyHour: 23 }, session);
  await signed(config, 'star', {}, crypto.randomUUID(), end + 1800);
  await summarizeDue(env.DB, end + 3600);
  expect(await scalar("SELECT COUNT(*) AS count FROM summaries WHERE kind='daily'")).toBe(1);
  await summarizeDue(env.DB, end + 86400 + 3600);
  const list = await env.DB.prepare(
    "SELECT * FROM summaries WHERE kind='daily' ORDER BY period_end",
  ).all();
  expect(list.results).toHaveLength(2);
  expect(list.results[0]).toMatchObject({ period_start: start, period_end: end, added: 0 });
  expect(list.results[1]).toMatchObject({
    period_start: end,
    period_end: end + 25 * 3600,
    added: 1,
  });
  // A stale invocation cannot change the first day's stored bounds or its members.
  await summarizePeriod(env.DB, config.id, start, end + 3600);
  expect(
    await env.DB.prepare('SELECT * FROM summaries WHERE period_end=?').bind(end).first(),
  ).toMatchObject({ period_start: start, added: 0, event_count: 0 });
});

it('bounds cron work across multiple projects and advances waiting projects on later invocations', async () => {
  const session = await setup();
  const end = latestDue(nowSeconds(), 23);
  for (let i = 0; i < 7; i++) {
    const config = await add(session, `owner/repo${i}`);
    await signed(
      config,
      'ping',
      { repository: { id: 100 + i, full_name: `owner/repo${i}`, stargazers_count: i } },
      crypto.randomUUID(),
      end - 3600,
    );
  }
  await summarizeDue(env.DB, end);
  expect(await scalar("SELECT COUNT(*) AS count FROM summaries WHERE kind='daily'")).toBe(6);
  await summarizeDue(env.DB, end + 60);
  expect(await scalar("SELECT COUNT(*) AS count FROM summaries WHERE kind='daily'")).toBe(7);
});

it('does not rewrite a completed summary when no new delivery can affect it', async () => {
  const config = await add(await setup());
  const end = latestDue(nowSeconds(), 23);
  await signed(config, 'ping', {}, crypto.randomUUID(), end - 3600);
  await summarizeDue(env.DB, end);
  await env.DB.prepare("UPDATE summaries SET computed_at=1 WHERE kind='daily'").run();
  await summarizeDue(env.DB, end + 60);
  expect(
    (await env.DB.prepare("SELECT computed_at FROM summaries WHERE kind='daily'").first())
      ?.computed_at,
  ).toBe(1);
  // A later-window event must not dirty this window either.
  await signed(config, 'star', {}, crypto.randomUUID(), end + 10);
  await summarizeDue(env.DB, end + 120);
  expect(
    (await env.DB.prepare("SELECT computed_at FROM summaries WHERE kind='daily'").first())
      ?.computed_at,
  ).toBe(1);
});
