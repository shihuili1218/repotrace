/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as bindings } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { initDB, migrations } from '../worker/db';
import {
  getWebhookCredentials,
  sealWebhookSecret,
  secretStatement,
} from '../worker/webhook-secrets';
import { localDay, localMidnight } from '../worker/time';
import { parseRepository } from '../worker/projects';
import { nowSeconds, type Env } from '../worker/types';
import type { Dashboard, MonitorData, WebhookConfig } from '../shared/types';

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
      forks_count: 2,
    },
    sender: { id: 1, login: 'octocat' },
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
      'DELETE FROM monitor_settings',
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
    for (const endpoint of ['/dashboard', '/settings', '/monitoring?type=issues']) {
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
    expect(data.summaries).toEqual([]);
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

const iso = (at: number) => new Date(at * 1000).toISOString();
const item = (id = 1001, patch: Record<string, unknown> = {}) => ({
  id,
  number: id - 1000,
  title: `Item ${id}`,
  user: { id: 10, login: 'author' },
  state: 'open',
  draft: false,
  labels: [{ name: 'bug' }],
  created_at: iso(nowSeconds() - 7200),
  updated_at: iso(nowSeconds() - 10),
  closed_at: null,
  ...patch,
});
const release = (id = 2001, patch: Record<string, unknown> = {}) => ({
  id,
  tag_name: `v1.${id - 2000}.0`,
  name: `Release ${id}`,
  author: { id: 10, login: 'author' },
  draft: false,
  prerelease: false,
  created_at: iso(nowSeconds() - 120),
  published_at: iso(nowSeconds() - 60),
  ...patch,
});
async function monitor(session: string, type: string, query = '') {
  const response = await request(`/monitoring?type=${type}${query}`, 'GET', undefined, session);
  expect(response.status).toBe(200);
  return response.json<MonitorData>();
}

describe('live analytics without scheduled work', () => {
  it('updates net changes immediately by Beijing calendar date and cancels opposite actions per stable user', async () => {
    const session = await setup();
    const config = await add(session);
    const midnight = localMidnight(nowSeconds());
    await signed(config, 'star', {}, crypto.randomUUID(), midnight - 1);
    await signed(
      config,
      'star',
      { action: 'deleted', starred_at: null },
      crypto.randomUUID(),
      midnight,
    );
    await signed(
      config,
      'star',
      { sender: { id: 2, login: 'old-name' } },
      crypto.randomUUID(),
      midnight,
    );
    await signed(
      config,
      'star',
      { action: 'deleted', sender: { id: 2, login: 'new-name' } },
      crypto.randomUUID(),
      midnight,
    );
    const data = await dashboard(session);
    expect(data.history.find((r) => r.day === localDay(midnight - 1))).toMatchObject({
      added: 1,
      removed: 0,
    });
    expect(data.history.at(-1)).toMatchObject({ added: 0, removed: 1, total: 10 });
    expect(data.eventCounts).toEqual({ added: 2, removed: 2 });
    expect(data.summaries).toHaveLength(0);
    expect('scheduled' in worker).toBe(false);
    expect((await request('/settings', 'PATCH', { dailyHour: 23 }, session)).status).toBe(404);
    expect(await (await request('/settings', 'GET', undefined, session)).json()).not.toHaveProperty(
      'dailyHour',
    );
  });
  it('carries observed totals over quiet days and uses optional counts without inventing zero', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config, 'ping', {}, crypto.randomUUID(), nowSeconds() - 4 * 86400);
    await signed(config, 'issues', {
      action: 'opened',
      issue: item(),
      repository: { id: 100, full_name: 'owner/repo' },
    });
    const data = await dashboard(session);
    expect(data.history.slice(-5).map((r) => [r.total, r.fork_total])).toEqual(
      Array.from({ length: 5 }, () => [10, 2]),
    );
    expect(data.repositories[0]).toMatchObject({ current_total: 10, current_forks: 2 });
    expect(data.repositories[0].receivedEvents).toContain('issues');
    expect(data.summaries).toHaveLength(0);
  });
  it('paginates and filters the unified activity feed and star list', async () => {
    const session = await setup();
    const config = await add(session);
    for (let id = 1; id <= 32; id++)
      await signed(config, 'star', { sender: { id, login: `user-${id}` } });
    await signed(config, 'issues', { action: 'opened', issue: item() });
    expect((await dashboard(session)).timeline).toHaveLength(30);
    expect((await dashboard(session, '?page=2')).timeline).toHaveLength(3);
    expect((await dashboard(session, '?category=issue')).timelineTotal).toBe(1);
    expect((await dashboard(session)).changeTotal).toBe(32);
    expect((await request('/dashboard?category=push', 'GET', undefined, session)).status).toBe(400);
  });
});

describe('fork growth', () => {
  it('records the fork owner and repository once and updates reported totals', async () => {
    const session = await setup();
    const config = await add(session);
    const delivery = crypto.randomUUID();
    const payload = {
      forkee: {
        id: 501,
        full_name: 'forker/project',
        owner: { id: 50, login: 'forker' },
        created_at: iso(nowSeconds()),
      },
    };
    expect((await signed(config, 'fork', payload, delivery)).status).toBe(200);
    await signed(config, 'fork', payload, delivery);
    await signed(config, 'fork', payload);
    const data = await dashboard(session);
    const list = await monitor(session, 'forks');
    expect(list.forks).toHaveLength(1);
    expect(list.forks[0]).toMatchObject({ owner_login: 'forker', full_name: 'forker/project' });
    expect(data.metrics.forks).toBe(1);
    expect(data.history.at(-1)?.fork_new).toBe(1);
  });
  it('rejects invalid fork identities and unsafe links', async () => {
    const config = await add(await setup());
    expect(
      (
        await signed(config, 'fork', {
          forkee: {
            id: 501,
            full_name: 'https://evil.example/a/b',
            owner: { id: 50, login: 'forker' },
          },
        })
      ).status,
    ).toBe(400);
    expect(await scalar('SELECT COUNT(*) AS count FROM forks')).toBe(0);
  });
});

describe('issues and pull requests', () => {
  it('tracks issues, labels, human first response, closing and reopening', async () => {
    const session = await setup();
    const config = await add(session);
    const issue = item();
    expect((await signed(config, 'issues', { action: 'opened', issue })).status).toBe(200);
    await signed(config, 'issue_comment', {
      action: 'created',
      issue,
      comment: { user: { id: 10, login: 'author' }, created_at: iso(nowSeconds() - 500) },
    });
    await signed(config, 'issue_comment', {
      action: 'created',
      issue,
      comment: {
        user: { id: 20, login: 'robot[bot]', type: 'Bot' },
        created_at: iso(nowSeconds() - 400),
      },
    });
    expect((await dashboard(session)).metrics.unansweredIssues).toBe(1);
    const replyAt = nowSeconds() - 300;
    await signed(config, 'issue_comment', {
      action: 'created',
      issue,
      comment: { user: { id: 30, login: 'helper' }, created_at: iso(replyAt) },
    });
    expect((await dashboard(session)).metrics).toMatchObject({
      openIssues: 1,
      unansweredIssues: 0,
      issuesOpened: 1,
      avgReplySeconds: replyAt - Date.parse(issue.created_at) / 1000,
    });
    const list = await monitor(session, 'issues', '&label=bug');
    expect(list.items[0].labels).toEqual(['bug']);
    expect(list.labels).toEqual(['bug']);
    await signed(config, 'issues', {
      action: 'closed',
      issue: {
        ...issue,
        state: 'closed',
        updated_at: iso(nowSeconds()),
        closed_at: iso(nowSeconds()),
      },
    });
    expect((await dashboard(session)).metrics).toMatchObject({ openIssues: 0, issuesClosed: 1 });
    expect((await monitor(session, 'issues', '&state=open')).total).toBe(0);
    await signed(config, 'issues', {
      action: 'reopened',
      issue: { ...issue, updated_at: iso(nowSeconds() + 1) },
    });
    expect((await monitor(session, 'issues', '&state=open')).total).toBe(1);
  });
  it('ignores out-of-order stale item state but can capture an earlier first response', async () => {
    const session = await setup();
    const config = await add(session);
    const issue = item();
    const replyAt = nowSeconds() - 500;
    await signed(config, 'issues', {
      action: 'closed',
      issue: { ...issue, state: 'closed', updated_at: iso(nowSeconds()) },
    });
    await signed(config, 'issues', { action: 'opened', issue });
    await signed(config, 'issue_comment', {
      action: 'created',
      issue,
      comment: { user: { id: 30, login: 'helper' }, created_at: iso(replyAt) },
    });
    const stored = (await monitor(session, 'issues')).items[0];
    expect(stored.state).toBe('closed');
    expect(stored.first_reply_at).toBe(replyAt);
  });
  it('distinguishes PR merging from closing and records review state, contributors and merge duration', async () => {
    const session = await setup();
    const config = await add(session);
    const pr = item(1002, { head: { sha: 'a'.repeat(40) } });
    await signed(config, 'pull_request', { action: 'opened', pull_request: pr });
    expect((await dashboard(session)).metrics.awaitingReview).toBe(1);
    await signed(config, 'pull_request_review', {
      action: 'submitted',
      pull_request: pr,
      review: {
        state: 'approved',
        user: { id: 30, login: 'reviewer' },
        submitted_at: iso(nowSeconds() - 5),
      },
    });
    expect((await monitor(session, 'pull_requests')).items[0].review_state).toBe('approved');
    expect((await dashboard(session)).metrics.awaitingReview).toBe(0);
    const mergedAt = nowSeconds();
    const merged = {
      ...pr,
      state: 'closed',
      merged: true,
      merged_at: iso(mergedAt),
      closed_at: iso(nowSeconds()),
      updated_at: iso(nowSeconds()),
    };
    await signed(config, 'pull_request', { action: 'closed', pull_request: merged });
    // PR issue comments must not turn a known merged PR into an ordinary closed issue.
    await signed(config, 'issue_comment', {
      action: 'created',
      issue: { ...pr, state: 'closed', updated_at: iso(nowSeconds() + 1), pull_request: {} },
      comment: { user: { id: 30, login: 'reviewer' }, created_at: iso(nowSeconds()) },
    });
    expect((await monitor(session, 'issues')).total).toBe(0);
    const list = await monitor(session, 'pull_requests', '&state=merged');
    expect(list.total).toBe(1);
    expect(list.contributors[0]).toMatchObject({ login: 'author', prs: 1, merged: 1 });
    expect((await dashboard(session)).metrics).toMatchObject({
      prsOpened: 1,
      prsMerged: 1,
      openPRs: 0,
      avgMergeSeconds: mergedAt - Date.parse(pr.created_at) / 1000,
    });
    await signed(config, 'pull_request', {
      action: 'closed',
      pull_request: item(1003, { state: 'closed', closed_at: iso(nowSeconds()) }),
    });
    expect((await monitor(session, 'pull_requests', '&state=closed')).total).toBe(1);
    expect((await dashboard(session)).metrics.prsMerged).toBe(1);
  });
  it('clears a previous review when new code arrives and handles PR comments as PR activity', async () => {
    const session = await setup();
    const config = await add(session);
    const pr = item(1002, { head: { sha: 'a'.repeat(40) } });
    await signed(config, 'pull_request_review', {
      action: 'submitted',
      pull_request: pr,
      review: {
        state: 'approved',
        user: { id: 30, login: 'reviewer' },
        submitted_at: iso(nowSeconds() - 5),
      },
    });
    await signed(config, 'pull_request', {
      action: 'synchronize',
      pull_request: { ...pr, head: { sha: 'b'.repeat(40) }, updated_at: iso(nowSeconds()) },
    });
    expect((await monitor(session, 'pull_requests')).items[0].review_state).toBeNull();
    expect((await dashboard(session)).metrics.awaitingReview).toBe(1);
    expect((await dashboard(session, '?category=pull_request')).timelineTotal).toBe(2);
  });
  it('does not count a previously existing issue first observed through a comment as a new issue', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config, 'issue_comment', {
      action: 'created',
      issue: item(),
      comment: { user: { id: 30, login: 'helper' }, created_at: iso(nowSeconds()) },
    });
    expect((await dashboard(session)).metrics).toMatchObject({ issuesOpened: 0, openIssues: 1 });
  });
});

describe('release history', () => {
  it('tracks stable and prerelease versions, release markers and publishing once', async () => {
    const session = await setup();
    const config = await add(session);
    const source = release();
    expect((await signed(config, 'release', { action: 'published', release: source })).status).toBe(
      200,
    );
    await signed(config, 'release', { action: 'released', release: source });
    await signed(config, 'release', {
      action: 'published',
      release: release(2002, { prerelease: true }),
    });
    const data = await dashboard(session);
    expect(data.metrics.releasesPublished).toBe(2);
    expect(data.metrics.latestRelease?.tag_name).toBe('v1.1.0');
    expect(data.releaseMarkers).toHaveLength(2);
    expect((await monitor(session, 'releases', '&state=stable')).total).toBe(1);
    expect((await monitor(session, 'releases', '&state=prerelease')).total).toBe(1);
  });
  it('excludes drafts, unpublished and deleted versions from the latest version and markers', async () => {
    const session = await setup();
    const config = await add(session);
    await signed(config, 'release', {
      action: 'created',
      release: release(2001, { draft: true, published_at: null }),
    });
    expect((await dashboard(session)).metrics.latestRelease).toBeNull();
    expect((await monitor(session, 'releases', '&state=draft')).total).toBe(1);
    const version = release(2002);
    await signed(config, 'release', { action: 'published', release: version });
    await signed(config, 'release', { action: 'unpublished', release: version });
    expect((await dashboard(session)).metrics.latestRelease).toBeNull();
    await signed(config, 'release', { action: 'deleted', release: version });
    await signed(config, 'release', { action: 'edited', release: version });
    expect((await monitor(session, 'releases', '&state=deleted')).total).toBe(1);
    expect((await dashboard(session)).releaseMarkers).toHaveLength(0);
  });
});

it('pauses all supported event types without losing delivery deduplication or cascading deletion', async () => {
  const session = await setup();
  const config = await add(session);
  await request(`/repositories/${config.id}`, 'PATCH', { enabled: false }, session);
  await signed(config, 'issues', { action: 'opened', issue: item() });
  await signed(config, 'release', { action: 'published', release: release() });
  expect(await scalar('SELECT COUNT(*) AS count FROM work_items')).toBe(0);
  expect(await scalar('SELECT COUNT(*) AS count FROM releases')).toBe(0);
  expect(await scalar('SELECT COUNT(*) AS count FROM project_events')).toBe(0);
  await request(`/repositories/${config.id}`, 'PATCH', { enabled: true }, session);
  await signed(config, 'issues', { action: 'opened', issue: item() });
  await request(`/repositories/${config.id}`, 'DELETE', {}, session);
  for (const table of ['work_items', 'releases', 'forks', 'project_events', 'webhook_deliveries'])
    expect(await scalar(`SELECT COUNT(*) AS count FROM ${table}`)).toBe(0);
});

it('upgrades the webhook/nightly version preserving encrypted secrets, raw events and historical summaries', async () => {
  const db = (bindings as unknown as { WEBHOOK_V3_DB: D1Database }).WEBHOOK_V3_DB;
  await db.batch([
    db.prepare('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)'),
    ...migrations[0].map((sql) => db.prepare(sql)),
    ...migrations[2].map((sql) => db.prepare(sql)),
    db.prepare('INSERT INTO schema_migrations VALUES (1),(2),(3)'),
  ]);
  const oldEnv = { ...env, DB: db };
  const secret = 'retained-signing-secret';
  await db
    .prepare(
      "INSERT INTO projects VALUES ('old',100,'owner/repo','Old project','TypeScript',1,100)",
    )
    .run();
  await secretStatement(db, 'old', await sealWebhookSecret(oldEnv, 'old', secret)).run();
  const at = nowSeconds() - 10;
  await db.batch([
    db.prepare("INSERT INTO monitor_settings VALUES ('last_cron_at','123')"),
    db
      .prepare(
        "INSERT INTO webhook_deliveries(project_id,delivery_id,event_name,received_at,observed_total,recorded,processed) VALUES ('old','old-delivery','star',?,42,1,1)",
      )
      .bind(at),
    db
      .prepare(
        "INSERT INTO star_events SELECT seq,'old',1,'octocat','added',NULL,? FROM webhook_deliveries",
      )
      .bind(at),
    db
      .prepare(
        "INSERT INTO summaries(id,project_id,kind,source,day,period_start,period_end,computed_at,total,added) VALUES ('old-summary','old','daily','webhook',?,100,200,200,40,1)",
      )
      .bind(localDay(at)),
    db.prepare("INSERT INTO summary_changes VALUES ('old-summary',1,'octocat','added',NULL,200)"),
  ]);
  await initDB(db);
  await initDB(db);
  expect((await getWebhookCredentials(oldEnv, 'old'))?.secret).toBe(secret);
  expect(await db.prepare('SELECT COUNT(*) AS count FROM star_events').first('count')).toBe(1);
  expect(await db.prepare('SELECT total FROM summaries').first('total')).toBe(40);
  expect(
    await db
      .prepare(
        "SELECT COUNT(*) AS count FROM monitor_settings WHERE key IN ('daily_hour','last_cron_at')",
      )
      .first('count'),
  ).toBe(0);
  expect(
    (await db.prepare('SELECT current_forks FROM webhook_connections').first())?.current_forks,
  ).toBeNull();
});

it('never treats an approval of an old commit as a current PR approval', async () => {
  const session = await setup();
  const config = await add(session);
  const pr = item(1002, { head: { sha: 'b'.repeat(40) } });
  await signed(config, 'pull_request', { action: 'opened', pull_request: pr });
  await signed(config, 'pull_request_review', {
    action: 'submitted',
    pull_request: pr,
    review: {
      state: 'approved',
      commit_id: 'a'.repeat(40),
      user: { id: 30, login: 'reviewer' },
      submitted_at: iso(nowSeconds()),
    },
  });
  expect((await monitor(session, 'pull_requests')).items[0].review_state).toBeNull();
  expect((await dashboard(session)).metrics.awaitingReview).toBe(1);
});

it('scopes and paginates item lists, validates filters and generates safe GitHub links', async () => {
  const session = await setup();
  const config = await add(session);
  for (let i = 1; i <= 32; i++)
    await signed(config, 'issues', {
      action: 'opened',
      issue: item(1000 + i, { html_url: 'javascript:alert(1)' }),
    });
  const second = await add(session, 'another/project');
  await signed(second, 'issues', {
    action: 'opened',
    issue: item(2001),
    repository: { id: 101, full_name: 'another/project' },
  });
  expect((await monitor(session, 'issues', `&repo=${config.id}`)).total).toBe(32);
  expect((await monitor(session, 'issues', `&repo=${config.id}&page=2`)).items).toHaveLength(2);
  expect((await dashboard(session, `?repo=${second.id}&category=issue`)).timeline[0].url).toBe(
    'https://github.com/another/project/issues/1001',
  );
  for (const query of [
    'type=invalid',
    'type=issues&page=0',
    'type=releases&state=invalid',
    'type=issues&repo=missing',
  ])
    expect((await request(`/monitoring?${query}`, 'GET', undefined, session)).status).toBe(
      query.includes('missing') ? 404 : 400,
    );
});

it('keeps a changed PR head when an older approval payload is delivered later in the same second', async () => {
  const session = await setup();
  const config = await add(session);
  const updated = iso(nowSeconds() - 5);
  const old = item(1002, { updated_at: updated, head: { sha: 'a'.repeat(40) } });
  await signed(config, 'pull_request', { action: 'opened', pull_request: old });
  await signed(config, 'pull_request', {
    action: 'synchronize',
    pull_request: { ...old, head: { sha: 'b'.repeat(40) } },
  });
  await signed(config, 'pull_request_review', {
    action: 'submitted',
    pull_request: old,
    review: {
      state: 'approved',
      commit_id: 'a'.repeat(40),
      user: { id: 30, login: 'reviewer' },
      submitted_at: iso(nowSeconds() - 1),
    },
  });
  expect((await monitor(session, 'pull_requests')).items[0].review_state).toBeNull();
  expect((await dashboard(session)).metrics.awaitingReview).toBe(1);
});

it('computes Issue and PR daily changes immediately and counts direct PR closure separately from merge', async () => {
  const session = await setup();
  const config = await add(session);
  const midnight = localMidnight(nowSeconds());
  const issue = item();
  await signed(config, 'issues', { action: 'opened', issue }, crypto.randomUUID(), midnight - 1);
  await signed(
    config,
    'issues',
    { action: 'closed', issue: { ...issue, state: 'closed', closed_at: iso(nowSeconds()) } },
    crypto.randomUUID(),
    midnight,
  );
  await signed(
    config,
    'pull_request',
    { action: 'opened', pull_request: item(1002) },
    crypto.randomUUID(),
    midnight,
  );
  const merged = { ...item(1002), state: 'closed', merged: true, merged_at: iso(nowSeconds()) };
  await signed(
    config,
    'pull_request',
    { action: 'closed', pull_request: merged },
    crypto.randomUUID(),
    midnight,
  );
  await signed(
    config,
    'pull_request',
    {
      action: 'closed',
      pull_request: item(1003, { state: 'closed', closed_at: iso(nowSeconds()) }),
    },
    crypto.randomUUID(),
    midnight,
  );
  const data = await dashboard(session);
  expect(data.history.find((r) => r.day === localDay(midnight - 1))).toMatchObject({
    issue_opened: 1,
    issue_closed: 0,
  });
  expect(data.history.at(-1)).toMatchObject({
    issue_opened: 0,
    issue_closed: 1,
    pr_opened: 1,
    pr_merged: 1,
    pr_closed: 1,
  });
  expect(data.metrics).toMatchObject({
    issuesOpened: 1,
    issuesClosed: 1,
    prsOpened: 1,
    prsMerged: 1,
    prsClosed: 1,
  });
});
