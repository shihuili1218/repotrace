/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as bindings } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { initDB, migrations } from '../worker/db';
import { getRepositoryToken, saveRepositoryToken } from '../worker/token-vault';
import {
  collectStars,
  continueSnapshot,
  enqueueDue,
  enqueueSnapshot,
  latestDue,
  localDay,
  retrySnapshot,
} from '../worker/monitors/stars';
import {
  github,
  GitHubError,
  parseRepository,
  type Stargazer,
  type StarProvider,
} from '../worker/github';
import { nowSeconds, type Env } from '../worker/types';
import type { Dashboard, Snapshot } from '../shared/types';

const env = bindings as unknown as Env;
const password = 'a-secure-test-password-2026';
const origin = 'https://repotrace.test';

async function request(
  path: string,
  method = 'GET',
  data?: unknown,
  cookie?: string,
  extra?: Record<string, string>,
  environment = env,
) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
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
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
async function setup() {
  const response = await request('/auth/setup', 'POST', { password });
  expect(response.status).toBe(201);
  return response.headers.get('Set-Cookie')!.split(';')[0];
}
const githubId = (id: string) =>
  id === 'repo' ? 100 : 1000 + [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
async function addRepo(
  id = 'repo',
  createdAt = nowSeconds() - 86400,
  token: string | null = 'test-token',
) {
  await env.DB.prepare(
    'INSERT INTO repositories(id,github_id,full_name,description,language,created_at) VALUES (?,?,?,?,?,?)',
  )
    .bind(id, githubId(id), `owner/${id}`, 'Test repository', 'TypeScript', createdAt)
    .run();
  if (token) await saveRepositoryToken(env, id, token);
}
const users = (...ids: number[]): Stargazer[] =>
  ids.map((id) => ({ id, login: `user-${id}`, starred_at: '2026-10-01T12:00:00Z' }));
function provider(list: Stargazer[]): StarProvider {
  return {
    repository: vi.fn(async () => ({
      id: 100,
      full_name: 'owner/repo',
      description: 'Test repository',
      language: 'TypeScript',
      stargazers_count: list.length,
    })),
    stargazers: vi.fn(async (_name, page) => ({
      users: list.slice((page - 1) * 100, page * 100),
      hasNext: page * 100 < list.length,
    })),
  };
}
async function snapshot(
  list: Stargazer[],
  kind: Snapshot['kind'] = 'baseline',
  day = localDay(nowSeconds()),
  at = nowSeconds(),
) {
  const id = await enqueueSnapshot(env.DB, 'repo', kind, day, at);
  await collectStars(env, provider(list));
  const value = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ?')
    .bind(id)
    .first<Snapshot>();
  expect(value?.status).toBe('complete');
  return value!;
}

beforeEach(async () => {
  await initDB(env.DB);
  const keys = await env.TOKEN_KEYS.list();
  await Promise.all(keys.keys.map((key) => env.TOKEN_KEYS.delete(key.name)));
  await env.DB.batch(
    [
      'DELETE FROM repositories',
      'DELETE FROM snapshots',
      'DELETE FROM sessions',
      'DELETE FROM admin',
      'DELETE FROM login_limits',
      "DELETE FROM monitor_settings WHERE key != 'daily_hour'",
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

  it('handles repository lifecycle through authenticated API and keeps data private', async () => {
    const session = await setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/stargazers?'))
        return Response.json([
          { starred_at: '2026-10-01T12:00:00Z', user: { id: 1, login: 'first-user' } },
        ]);
      return Response.json({
        id: 100,
        full_name: 'owner/repo',
        description: 'Test',
        language: 'TypeScript',
        stargazers_count: 1,
      });
    });
    const added = await request(
      '/repositories',
      'POST',
      { repository: 'owner/repo', token: 'test-token' },
      session,
    );
    expect(added.status).toBe(201);
    const { id } = await added.json<{ id: string }>();
    const data = await (await request('/dashboard', 'GET', undefined, session)).json<Dashboard>();
    expect(data.repositories[0].latest?.total).toBe(1);
    expect(data.changes).toHaveLength(0);
    expect(
      (
        await request(
          '/repositories',
          'POST',
          { repository: 'owner/repo', token: 'test-token' },
          session,
        )
      ).status,
    ).toBe(409);
    expect(
      (await request(`/repositories/${id}`, 'PATCH', { enabled: false }, session)).status,
    ).toBe(200);
    expect((await request(`/repositories/${id}/sync`, 'POST', {}, session)).status).toBe(409);
    expect((await request('/settings', 'PATCH', { dailyHour: 25 }, session)).status).toBe(400);
    expect((await request('/settings', 'PATCH', { dailyHour: 22 }, session)).status).toBe(200);
    expect(
      (await (await request('/settings', 'GET', undefined, session)).json<{ dailyHour: number }>())
        .dailyHour,
    ).toBe(22);
    expect((await request(`/repositories/${id}`, 'DELETE', {}, session)).status).toBe(200);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM snapshot_members').first('count'),
    ).toBe(0);
  });
});

describe('project credentials', () => {
  it('rejects missing or malformed project tokens before any outgoing request', async () => {
    const outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected request'));
    const session = await setup();
    for (const token of [undefined, '', '   ', 'bad\ntoken']) {
      await expect(github(token as string).repository('owner/repo')).rejects.toMatchObject({
        status: 400,
      });
      const response = await request(
        '/repositories',
        'POST',
        { repository: 'owner/repo', token },
        session,
      );
      expect(response.status).toBe(400);
    }
    expect(outbound).not.toHaveBeenCalled();
  });

  it('encrypts tokens with separate KV key material and never returns token contents', async () => {
    await addRepo('repo', undefined, 'private-project-token');
    const stored = await env.DB.prepare('SELECT * FROM repository_tokens WHERE repo_id = ?')
      .bind('repo')
      .first<{ key_id: string; ciphertext: string }>();
    expect(stored?.ciphertext).not.toContain('private-project-token');
    expect(await getRepositoryToken(env, 'repo')).toBe('private-project-token');
    const rawKey = await env.TOKEN_KEYS.get(`vault/${stored!.key_id}`, 'arrayBuffer');
    expect(rawKey?.byteLength).toBe(32);
    const session = await setup();
    const response = await request('/dashboard', 'GET', undefined, session);
    const json = await response.json<Dashboard>();
    expect(json.repositories[0].tokenConfigured).toBe(true);
    expect(JSON.stringify(json)).not.toContain('private-project-token');
    expect(JSON.stringify(json)).not.toContain(stored!.ciphertext);
  });

  it('initializes the vault safely for concurrent projects and binds ciphertext to its project', async () => {
    await addRepo('alpha', undefined, null);
    await addRepo('beta', undefined, null);
    await Promise.all([
      saveRepositoryToken(env, 'alpha', 'token-alpha'),
      saveRepositoryToken(env, 'beta', 'token-beta'),
    ]);
    expect(await getRepositoryToken(env, 'alpha')).toBe('token-alpha');
    expect(await getRepositoryToken(env, 'beta')).toBe('token-beta');
    const records = await env.DB.prepare(
      'SELECT key_id,ciphertext FROM repository_tokens ORDER BY repo_id',
    ).all<{ key_id: string; ciphertext: string }>();
    expect(records.results[0].key_id).toBe(records.results[1].key_id);
    expect((await env.TOKEN_KEYS.list()).keys).toHaveLength(1);
    await env.DB.prepare('UPDATE repository_tokens SET ciphertext = ? WHERE repo_id = ?')
      .bind(records.results[0].ciphertext, 'beta')
      .run();
    await expect(getRepositoryToken(env, 'beta')).rejects.toMatchObject({ status: 503 });
  });

  it('uses each repository own token for all collection requests', async () => {
    await addRepo('alpha', undefined, 'token-alpha');
    await addRepo('beta', undefined, 'token-beta');
    for (const id of ['alpha', 'beta']) await enqueueSnapshot(env.DB, id, 'baseline');
    const outbound = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = new URL(String(input));
      const name = url.pathname.split('/')[3];
      expect((options?.headers as Record<string, string>).Authorization).toBe(
        `Bearer token-${name}`,
      );
      if (url.pathname.endsWith('/stargazers'))
        return Response.json([
          {
            starred_at: '2026-11-01T00:00:00Z',
            user: { id: name === 'alpha' ? 1 : 2, login: `${name}-user` },
          },
        ]);
      return Response.json({
        id: githubId(name),
        full_name: `owner/${name}`,
        description: '',
        language: null,
        stargazers_count: 1,
      });
    });
    await collectStars(env);
    expect(outbound).toHaveBeenCalledTimes(6);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM snapshots WHERE status = 'complete'",
      ).first('count'),
    ).toBe(2);
  });

  it('starts the newly added project even when another project already has a queued job', async () => {
    await addRepo('alpha', undefined, 'token-alpha');
    await enqueueSnapshot(env.DB, 'alpha', 'baseline');
    const session = await setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      expect(String(input)).toContain('/owner/beta');
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer token-beta');
      return String(input).includes('/stargazers?')
        ? Response.json([
            { starred_at: '2026-11-01T00:00:00Z', user: { id: 1, login: 'beta-user' } },
          ])
        : Response.json({
            id: githubId('beta'),
            full_name: 'owner/beta',
            description: '',
            language: null,
            stargazers_count: 1,
          });
    });
    expect(
      (
        await request(
          '/repositories',
          'POST',
          { repository: 'owner/beta', token: 'token-beta' },
          session,
        )
      ).status,
    ).toBe(201);
    const data = await (await request('/dashboard', 'GET', undefined, session)).json<Dashboard>();
    expect(data.repositories.find((r) => r.full_name === 'owner/beta')?.latest?.total).toBe(1);
    expect(data.repositories.find((r) => r.id === 'alpha')?.active?.total).toBe(0);
  });

  it('keeps historical data while an existing project waits for its own token', async () => {
    await addRepo();
    const baseline = await snapshot(users(1, 2));
    await env.DB.prepare('DELETE FROM repository_tokens WHERE repo_id = ?').bind('repo').run();
    const id = await enqueueSnapshot(env.DB, 'repo', 'manual');
    const source = provider(users(1, 2, 3));
    await collectStars(env, source);
    expect(source.repository).not.toHaveBeenCalled();
    const session = await setup();
    const data = await (await request('/dashboard', 'GET', undefined, session)).json<Dashboard>();
    expect(data.repositories[0].latest?.id).toBe(baseline.id);
    expect(data.repositories[0].tokenConfigured).toBe(false);
    expect((await request('/repositories/repo/sync', 'POST', {}, session)).status).toBe(409);
    await saveRepositoryToken(env, 'repo', 'new-project-token');
    await collectStars(env, source);
    expect(
      await env.DB.prepare('SELECT status,total FROM snapshots WHERE id = ?').bind(id).first(),
    ).toEqual({ status: 'complete', total: 3 });
  });

  it('validates a replacement before saving, then clears obsolete backoff and resumes', async () => {
    await addRepo();
    const id = await enqueueSnapshot(env.DB, 'repo', 'baseline');
    await env.DB.prepare('UPDATE snapshots SET retry_at=?, error=? WHERE id=?')
      .bind(nowSeconds() + 3600, 'old error', id)
      .run();
    const session = await setup();
    const outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }));
    expect(
      (await request('/repositories/repo/token', 'PUT', { token: 'bad-token' }, session)).status,
    ).toBe(502);
    expect(await getRepositoryToken(env, 'repo')).toBe('test-token');
    outbound.mockImplementation(async (input) =>
      String(input).includes('/stargazers?')
        ? Response.json([
            { starred_at: '2026-11-01T00:00:00Z', user: { id: 1, login: 'first-user' } },
          ])
        : Response.json({
            id: 100,
            full_name: 'owner/repo',
            description: '',
            language: null,
            stargazers_count: 1,
          }),
    );
    const response = await request(
      '/repositories/repo/token',
      'PUT',
      { token: 'updated-token' },
      session,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('updated-token');
    expect(await getRepositoryToken(env, 'repo')).toBe('updated-token');
    expect(
      await env.DB.prepare('SELECT status,error,retry_at FROM snapshots WHERE id = ?')
        .bind(id)
        .first(),
    ).toEqual({ status: 'complete', error: null, retry_at: 0 });
  });

  it('rejects inaccessible stargazers before creating a project and ends a revoked-token job', async () => {
    const session = await setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/stargazers?')
        ? Response.json(
            { message: 'Resource not accessible by personal access token' },
            { status: 403, headers: { 'X-GitHub-Request-Id': 'ABCD:1234:0001' } },
          )
        : Response.json({
            id: 100,
            full_name: 'owner/repo',
            description: '',
            language: null,
            stargazers_count: 1,
          }),
    );
    const rejected = await request(
      '/repositories',
      'POST',
      { repository: 'owner/repo', token: 'project-token' },
      session,
    );
    expect(rejected.status).toBe(502);
    const rejection = await rejected.json();
    expect(rejection).toMatchObject({
      error: expect.stringContaining('403'),
      github: {
        status: 403,
        operation: 'stargazers',
        reason: 'permission',
        message: 'Resource not accessible by personal access token',
        requestId: 'ABCD:1234:0001',
      },
    });
    expect(JSON.stringify(rejection)).not.toContain('project-token');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM repositories').first('count')).toBe(
      0,
    );
    await addRepo();
    const id = await enqueueSnapshot(env.DB, 'repo', 'baseline');
    await collectStars(env);
    expect(
      await env.DB.prepare('SELECT status FROM snapshots WHERE id = ?').bind(id).first('status'),
    ).toBe('failed');
  });

  it('migrates existing data and removes the obsolete global-token advice from persisted errors', async () => {
    const legacy = (bindings as unknown as { LEGACY_DB: D1Database }).LEGACY_DB;
    await legacy.batch([
      ...migrations[0].map((sql) => legacy.prepare(sql)),
      legacy.prepare('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)'),
      legacy.prepare('INSERT INTO schema_migrations(version) VALUES (1)'),
      legacy.prepare(
        "INSERT INTO repositories(id,github_id,full_name,description,created_at) VALUES ('old',100,'owner/old','',1)",
      ),
      legacy
        .prepare(
          "INSERT INTO snapshots(id,repo_id,kind,day,started_at,error) VALUES ('old-snapshot','old','baseline','2026-11-01',1,?)",
        )
        .bind('GitHub API 额度受限，等待额度恢复后继续。可配置 GITHUB_TOKEN 提高额度。'),
    ]);
    await initDB(legacy);
    expect(await legacy.prepare('SELECT COUNT(*) AS count FROM repositories').first('count')).toBe(
      1,
    );
    expect(await legacy.prepare('SELECT error FROM snapshots').first('error')).toBe(
      'GitHub 暂时限制请求，稍后自动重试。',
    );
    expect(
      await legacy.prepare('SELECT COUNT(*) AS count FROM repository_tokens').first('count'),
    ).toBe(0);
  });
});

describe('complete, resumable Star snapshots', () => {
  it('finishes a 519-star collection through bounded HTTP continuations', async () => {
    const list = users(...Array.from({ length: 519 }, (_, i) => i + 1));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith('/stargazers'))
        return Response.json({
          id: 100,
          full_name: 'owner/repo',
          description: '',
          language: null,
          stargazers_count: 519,
        });
      const page = Number(url.searchParams.get('page') ?? 1);
      return Response.json(
        list.slice((page - 1) * 100, page * 100).map((user) => ({
          starred_at: user.starred_at,
          user: { id: user.id, login: user.login },
        })),
        {
          headers:
            page < 6
              ? {
                  Link: `<https://api.github.com/repos/owner/repo/stargazers?page=${page + 1}>; rel="next"`,
                }
              : {},
        },
      );
    });
    const session = await setup();
    const created = await request(
      '/repositories',
      'POST',
      { repository: 'owner/repo', token: 'project-token' },
      session,
    );
    expect(created.status).toBe(201);
    let data = await (await request('/dashboard', 'GET', undefined, session)).json<Dashboard>();
    expect(data.repositories[0].active?.total).toBe(100);
    const id = data.repositories[0].active!.id;
    for (let page = 2; page <= 6; page++) {
      const response = await request(`/snapshots/${id}/continue`, 'POST', {}, session);
      expect(response.status).toBe(200);
    }
    data = await (await request('/dashboard', 'GET', undefined, session)).json<Dashboard>();
    expect(data.repositories[0].active).toBeNull();
    expect(data.repositories[0].latest).toMatchObject({
      status: 'complete',
      total: 519,
      added: 0,
      removed: 0,
    });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM snapshot_members WHERE snapshot_id = ?')
        .bind(id)
        .first('count'),
    ).toBe(519);
  });

  it('respects live leases and retry time when continuing a snapshot', async () => {
    await addRepo();
    const id = await enqueueSnapshot(env.DB, 'repo', 'baseline');
    const source = provider(users(1));
    await env.DB.prepare('UPDATE snapshots SET lease_until=? WHERE id=?')
      .bind(nowSeconds() + 180, id)
      .run();
    await expect(continueSnapshot(env, id!, source)).rejects.toMatchObject({ status: 409 });
    await env.DB.prepare('UPDATE snapshots SET lease_until=0,retry_at=? WHERE id=?')
      .bind(nowSeconds() + 180, id)
      .run();
    await expect(continueSnapshot(env, id!, source)).rejects.toMatchObject({ status: 429 });
    expect(source.repository).not.toHaveBeenCalled();
    await env.DB.prepare('UPDATE snapshots SET retry_at=0 WHERE id=?').bind(id).run();
    expect(await continueSnapshot(env, id!, source)).toMatchObject({
      status: 'complete',
      total: 1,
    });
  });

  it('runs scheduled collection with the saved project token and records the trigger time', async () => {
    await addRepo();
    const id = await enqueueSnapshot(env.DB, 'repo', 'baseline');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
      return String(input).includes('/stargazers?')
        ? Response.json([
            { starred_at: '2026-11-01T00:00:00Z', user: { id: 1, login: 'first-user' } },
          ])
        : Response.json({
            id: 100,
            full_name: 'owner/repo',
            description: '',
            language: null,
            stargazers_count: 1,
          });
    });
    const before = nowSeconds();
    const ctx = createExecutionContext();
    await worker.scheduled({} as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(
      await env.DB.prepare('SELECT status,total FROM snapshots WHERE id = ?').bind(id).first(),
    ).toEqual({ status: 'complete', total: 1 });
    expect(
      Number(
        await env.DB.prepare("SELECT value FROM monitor_settings WHERE key='last_cron_at'").first(
          'value',
        ),
      ),
    ).toBeGreaterThanOrEqual(before);
  });

  it('builds a baseline then records added/removed IDs while ignoring username changes', async () => {
    await addRepo();
    const baseline = await snapshot(users(1, 2));
    expect([baseline.added, baseline.removed, baseline.comparison_id]).toEqual([0, 0, null]);
    const daily = await snapshot([{ ...users(1)[0], login: 'renamed-user' }, ...users(3)], 'daily');
    expect([daily.total, daily.added, daily.removed, daily.comparison_id]).toEqual([
      2,
      1,
      1,
      baseline.id,
    ]);
    const diff = await env.DB.prepare(
      'SELECT user_id,kind FROM star_changes WHERE snapshot_id = ? ORDER BY user_id',
    )
      .bind(daily.id)
      .all();
    expect(diff.results).toEqual([
      { user_id: 2, kind: 'removed' },
      { user_id: 3, kind: 'added' },
    ]);
  });

  it('keeps the nightly comparison independent of manual refreshes', async () => {
    await addRepo();
    const baseline = await snapshot(users(1, 2), 'baseline', '2026-10-28', nowSeconds() - 100);
    await snapshot(users(1, 2, 3), 'manual', '2026-10-29', nowSeconds() - 50);
    const daily = await snapshot(users(1, 3), 'daily', '2026-10-30');
    expect(daily.comparison_id).toBe(baseline.id);
    expect([daily.added, daily.removed]).toEqual([1, 1]);
    const next = await snapshot(users(1, 4), 'daily', '2026-10-31', nowSeconds() + 1);
    expect(next.comparison_id).toBe(daily.id);
    expect([next.added, next.removed]).toEqual([1, 1]);
  });

  it('checkpoints pagination, retries transient failures, and publishes only a complete set', async () => {
    await addRepo();
    const list = users(...Array.from({ length: 135 }, (_, i) => i + 1));
    const source = provider(list);
    const id = await enqueueSnapshot(env.DB, 'repo', 'baseline');
    await collectStars(env, source, 1);
    let row = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ?')
      .bind(id)
      .first<Snapshot>();
    expect([row?.status, row?.page, row?.total]).toEqual(['collecting', 2, 100]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM star_changes').first('count')).toBe(
      0,
    );
    const failing: StarProvider = {
      ...source,
      stargazers: vi.fn(async () => {
        throw new GitHubError('temporary', 0, true);
      }),
    };
    await collectStars(env, failing);
    row = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ?').bind(id).first<Snapshot>();
    expect(row?.status).toBe('collecting');
    expect(row?.page).toBe(2);
    await env.DB.prepare('UPDATE snapshots SET retry_at = 0 WHERE id = ?').bind(id).run();
    await collectStars(env, source);
    row = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ?').bind(id).first<Snapshot>();
    expect([row?.status, row?.total]).toEqual(['complete', 135]);
    expect(source.stargazers).toHaveBeenLastCalledWith('owner/repo', 2);
  });

  it('retains the last complete snapshot when GitHub truncates or rejects a new collection', async () => {
    await addRepo();
    const baseline = await snapshot(users(1, 2));
    const id = await enqueueSnapshot(env.DB, 'repo', 'manual');
    const truncated = provider(users(1, 2));
    truncated.stargazers = async () => ({ users: users(1), hasNext: false });
    await collectStars(env, truncated);
    const failed = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ?')
      .bind(id)
      .first<Snapshot>();
    expect(failed?.status).toBe('failed');
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM star_changes WHERE snapshot_id = ?')
        .bind(id)
        .first('count'),
    ).toBe(0);
    const session = await setup();
    const d = await (await request('/dashboard', 'GET', undefined, session)).json<Dashboard>();
    expect(d.repositories[0].latest?.id).toBe(baseline.id);
    expect(d.repositories[0].lastError).toContain('完整性检查');
    await retrySnapshot(env.DB, id!);
    await collectStars(env, provider(users(1, 3)));
    const completed = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ?')
      .bind(id)
      .first<Snapshot>();
    expect([completed?.status, completed?.added, completed?.removed]).toEqual(['complete', 1, 1]);
  });

  it('uses a database lease so overlapping invocations do not duplicate a collection', async () => {
    await addRepo();
    const id = await enqueueSnapshot(env.DB, 'repo', 'baseline');
    expect(await enqueueSnapshot(env.DB, 'repo', 'manual')).toBe(id);
    const source = provider(users(1));
    await Promise.all([collectStars(env, source), collectStars(env, source)]);
    expect(source.stargazers).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM snapshots WHERE status = 'complete'",
      ).first('count'),
    ).toBe(1);
  });

  it('supports empty repositories and does not treat their first snapshot as cancellations', async () => {
    await addRepo();
    const row = await snapshot([]);
    expect([row.total, row.added, row.removed]).toEqual([0, 0, 0]);
    const daily = await snapshot(users(2), 'daily');
    expect([daily.total, daily.added, daily.removed]).toEqual([1, 1, 0]);
  });

  it('never backdates a historical failed snapshot when the administrator retries it', async () => {
    await addRepo();
    await snapshot(users(1), 'baseline', '2020-01-01', nowSeconds() - 100);
    const old = await enqueueSnapshot(env.DB, 'repo', 'daily', '2020-01-02', nowSeconds() - 50);
    await env.DB.prepare(
      "UPDATE snapshots SET status = 'failed',error = 'upstream unavailable' WHERE id = ?",
    )
      .bind(old)
      .run();
    const retry = await retrySnapshot(env.DB, old!);
    expect(retry).not.toBe(old);
    await collectStars(env, provider(users(1, 2)));
    const fresh = await env.DB.prepare('SELECT * FROM snapshots WHERE id = ?')
      .bind(retry)
      .first<Snapshot>();
    expect([fresh?.kind, fresh?.day, fresh?.status]).toEqual([
      'manual',
      localDay(nowSeconds()),
      'complete',
    ]);
    expect(
      await env.DB.prepare('SELECT status FROM snapshots WHERE id = ?').bind(old).first('status'),
    ).toBe('failed');
  });
});

describe('scheduling, charts and upstream behavior', () => {
  it('enqueues one nightly snapshot after the local scheduled hour, with no fictional backfill', async () => {
    const before = Date.parse('2026-10-31T22:59:00+08:00') / 1000;
    const after = Date.parse('2026-10-31T23:00:00+08:00') / 1000;
    expect(latestDue(before, 23).day).toBe('2026-10-30');
    expect(latestDue(after, 23).day).toBe('2026-10-31');
    await addRepo('repo', before - 60);
    await enqueueDue(env.DB, before);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM snapshots').first('count')).toBe(0);
    await enqueueDue(env.DB, after);
    await enqueueDue(env.DB, after + 60);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM snapshots').first('count')).toBe(1);
    expect(await env.DB.prepare('SELECT day FROM snapshots').first('day')).toBe('2026-10-31');
  });

  it('paginates/filter changes, selects historical snapshots, and carries chart totals over gaps', async () => {
    await addRepo();
    const yesterday = localDay(nowSeconds() - 86400);
    const baseline = await snapshot(users(1), 'baseline', yesterday, nowSeconds() - 100);
    const latest = await snapshot(users(...Array.from({ length: 36 }, (_, i) => i + 1)), 'daily');
    const cookie = await setup();
    const first = await (await request('/dashboard', 'GET', undefined, cookie)).json<Dashboard>();
    expect(first.changeTotal).toBe(35);
    expect(first.changes).toHaveLength(30);
    expect(first.history.at(-1)?.total).toBe(36);
    expect(first.history.at(-2)?.total).toBe(1);
    const next = await (
      await request('/dashboard?page=2&kind=added', 'GET', undefined, cookie)
    ).json<Dashboard>();
    expect(next.changes).toHaveLength(5);
    const old = await (
      await request(`/dashboard?snapshot=${baseline.id}`, 'GET', undefined, cookie)
    ).json<Dashboard>();
    expect(old.changeTotal).toBe(0);
    expect(first.repositories[0].latest?.id).toBe(latest.id);
    expect((await request('/dashboard?days=999', 'GET', undefined, cookie)).status).toBe(400);
  });

  it('accepts GitHub repository formats and rejects arbitrary URLs / path injection', () => {
    expect(parseRepository('https://github.com/shihuili1218/repotrace.git')).toBe(
      'shihuili1218/repotrace',
    );
    for (const input of [
      'https://evil.test/a/b',
      'owner/../',
      'a/b/issues',
      'a/b?token=test',
      'a/..',
    ])
      expect(() => parseRepository(input)).toThrow();
  });

  it('maps GitHub rate limits to deferred retries and preserves token confidentiality', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 403,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(nowSeconds() + 600),
        },
      }),
    );
    await expect(github('test-token').repository('owner/repo')).rejects.toMatchObject({
      transient: true,
    });
    const [, options] = mock.mock.calls[0];
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    mock.mockResolvedValue(
      Response.json(
        [{ starred_at: '2026-10-31T00:00:00Z', user: { id: 1, login: 'star-bot[bot]' } }],
        {
          headers: {
            Link: '<https://api.github.com/repos/owner/repo/stargazers?page=2>; rel="next"',
          },
        },
      ),
    );
    const page = await github('test-token').stargazers('owner/repo', 1);
    expect(page.hasNext).toBe(true);
    expect(page.users[0].id).toBe(1);
    expect(page.users[0].login).toBe('star-bot[bot]');
  });
});
