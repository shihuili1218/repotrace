import {
  authenticated,
  constantTimeEqual,
  cookie,
  createSession,
  digest,
  logout,
  newPassword,
  rateLimit,
  verifyPassword,
} from './auth';
import { initDB } from './db';
import { dashboard } from './dashboard';
import { github, GitHubError, parseRepository } from './github';
import {
  collectStars,
  enqueueDue,
  enqueueSnapshot,
  retrySnapshot,
  starMonitor,
} from './monitors/stars';
import { AppError, type Env, json, nowSeconds } from './types';

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new AppError(415, '请使用 JSON 格式。');
  if (Number(request.headers.get('Content-Length') ?? 0) > 4096)
    throw new AppError(413, '请求内容过大。');
  // Bound streamed bodies too; Content-Length may be absent or forged.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, '请求内容为空。');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new AppError(413, '请求内容过大。');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.length;
    }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid JSON');
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, '请求 JSON 无效。');
  } finally {
    reader.releaseLock();
  }
}

async function api(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  await initDB(env.DB);
  if (!['GET', 'HEAD'].includes(method)) {
    if (request.headers.get('Origin') !== url.origin)
      throw new AppError(403, '请求来源无效，请从本站操作。');
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      throw new AppError(415, '请使用 JSON 格式。');
  }
  if (path === '/api/auth/status' && method === 'GET') {
    const admin = await env.DB.prepare('SELECT 1 FROM admin WHERE id = 1').first();
    return json({
      initialized: !!admin,
      authenticated: admin ? await authenticated(request, env.DB) : false,
      setupProtected: !!env.SETUP_TOKEN,
    });
  }
  if (path === '/api/auth/setup' && method === 'POST') {
    if (await env.DB.prepare('SELECT 1 FROM admin WHERE id = 1').first())
      throw new AppError(409, '管理员已设置，请登录。');
    await rateLimit(request, env.DB);
    const data = await body(request);
    if (
      env.SETUP_TOKEN &&
      (typeof data.setupToken !== 'string' ||
        !constantTimeEqual(await digest(data.setupToken), await digest(env.SETUP_TOKEN)))
    )
      throw new AppError(403, '初始化口令不正确。');
    const pw = await newPassword(data.password as string);
    const inserted = await env.DB.prepare(
      'INSERT OR IGNORE INTO admin(id,hash,salt,iterations) VALUES (1,?,?,?)',
    )
      .bind(pw.hash, pw.salt, pw.iterations)
      .run();
    if (!inserted.meta.changes) throw new AppError(409, '管理员已设置，请登录。');
    return json({ ok: true }, 201, { 'Set-Cookie': await createSession(env.DB, request) });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    await rateLimit(request, env.DB);
    const data = await body(request);
    await verifyPassword(env.DB, data.password);
    return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env.DB, request) });
  }
  if (!(await authenticated(request, env.DB))) throw new AppError(401, '请先登录。');
  if (path === '/api/auth/logout' && method === 'POST') {
    await logout(request, env.DB);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request) });
  }
  if (path === '/api/auth/password' && method === 'POST') {
    await rateLimit(request, env.DB);
    const data = await body(request);
    await verifyPassword(env.DB, data.currentPassword);
    const pw = await newPassword(data.password as string);
    await env.DB.batch([
      env.DB.prepare('UPDATE admin SET hash = ?,salt = ?,iterations = ? WHERE id = 1').bind(
        pw.hash,
        pw.salt,
        pw.iterations,
      ),
      env.DB.prepare('DELETE FROM sessions'),
    ]);
    return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env.DB, request) });
  }
  if (path === '/api/dashboard' && method === 'GET') return json(await dashboard(env.DB, url));
  if (path === '/api/settings' && method === 'GET') {
    const hour = await env.DB.prepare(
      "SELECT value FROM monitor_settings WHERE key = 'daily_hour'",
    ).first<{ value: string }>();
    return json({
      dailyHour: Number(hour?.value ?? 23),
      timezone: 'Asia/Shanghai',
      githubTokenConfigured: !!env.GITHUB_TOKEN,
      monitors: [starMonitor],
    });
  }
  if (path === '/api/settings' && method === 'PATCH') {
    const { dailyHour } = await body(request);
    if (
      typeof dailyHour !== 'number' ||
      !Number.isInteger(dailyHour) ||
      dailyHour < 0 ||
      dailyHour > 23
    )
      throw new AppError(400, '采集时间应为 0–23 时。');
    await env.DB.prepare("UPDATE monitor_settings SET value = ? WHERE key = 'daily_hour'")
      .bind(String(dailyHour))
      .run();
    return json({ ok: true });
  }
  if (path === '/api/repositories' && method === 'POST') {
    const data = await body(request);
    const name = parseRepository(data.repository);
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM repositories').first<{
      count: number;
    }>();
    if ((count?.count ?? 0) >= 20) throw new AppError(400, '第一版最多监控 20 个仓库。');
    const repo = await github(env).repository(name);
    if (
      await env.DB.prepare('SELECT 1 FROM repositories WHERE github_id = ? OR full_name = ?')
        .bind(repo.id, repo.full_name)
        .first()
    )
      throw new AppError(409, '这个仓库已经在监控中了。');
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        'INSERT INTO repositories(id,github_id,full_name,description,language,created_at) VALUES (?,?,?,?,?,?)',
      )
        .bind(id, repo.id, repo.full_name, repo.description ?? '', repo.language, nowSeconds())
        .run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new AppError(409, '这个仓库已经在监控中了。');
      throw error;
    }
    await enqueueSnapshot(env.DB, id, 'baseline');
    ctx.waitUntil(collectStars(env));
    return json({ id }, 201);
  }
  const repository = path.match(/^\/api\/repositories\/([^/]+)(?:\/(sync))?$/);
  if (repository) {
    const id = repository[1];
    if (!(await env.DB.prepare('SELECT id FROM repositories WHERE id = ?').bind(id).first()))
      throw new AppError(404, '仓库不存在。');
    if (repository[2] === 'sync' && method === 'POST') {
      const repo = await env.DB.prepare('SELECT enabled FROM repositories WHERE id = ?')
        .bind(id)
        .first<{ enabled: number }>();
      if (!repo?.enabled) throw new AppError(409, '请先恢复此仓库的监控。');
      const last = await env.DB.prepare(
        'SELECT started_at FROM snapshots WHERE repo_id = ? ORDER BY started_at DESC LIMIT 1',
      )
        .bind(id)
        .first<{ started_at: number }>();
      if (last && nowSeconds() - last.started_at < 60)
        throw new AppError(429, '快照刚刚启动，请稍等一分钟再刷新。');
      const snapshotId = await enqueueSnapshot(env.DB, id, 'manual');
      ctx.waitUntil(collectStars(env));
      return json({ id: snapshotId }, 202);
    }
    if (!repository[2] && method === 'PATCH') {
      const { enabled } = await body(request);
      if (typeof enabled !== 'boolean') throw new AppError(400, '监控开关无效。');
      await env.DB.prepare('UPDATE repositories SET enabled = ? WHERE id = ?')
        .bind(Number(enabled), id)
        .run();
      if (enabled) ctx.waitUntil(collectStars(env));
      return json({ ok: true });
    }
    if (!repository[2] && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM repositories WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }
  const retry = path.match(/^\/api\/snapshots\/([^/]+)\/retry$/);
  if (retry && method === 'POST') {
    const id = await retrySnapshot(env.DB, retry[1]);
    ctx.waitUntil(collectStars(env));
    return json({ ok: true, id }, 202);
  }
  throw new AppError(404, '接口不存在。');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    try {
      response = new URL(request.url).pathname.startsWith('/api/')
        ? await api(request, env, ctx)
        : await env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof AppError) response = json({ error: error.message }, error.status);
      else if (error instanceof GitHubError) response = json({ error: error.message }, 502);
      else {
        // Log a class only: SQL bindings / upstream errors may contain sensitive data.
        console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
        response = json({ error: '服务暂时不可用，请稍后重试。' }, 500);
      }
    }
    const secured = new Response(response.body, response);
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('Referrer-Policy', 'no-referrer');
    secured.headers.set('X-Frame-Options', 'DENY');
    secured.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    secured.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (new URL(request.url).pathname.startsWith('/api/'))
      secured.headers.set('Cache-Control', 'no-store');
    if (new URL(request.url).protocol === 'https:')
      secured.headers.set('Strict-Transport-Security', 'max-age=31536000');
    return secured;
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    await initDB(env.DB);
    await enqueueDue(env.DB);
    ctx.waitUntil(collectStars(env));
  },
} satisfies ExportedHandler<Env>;
