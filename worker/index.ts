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
import { parseRepository } from './projects';
import { sealWebhookSecret, secretStatement } from './webhook-secrets';
import { newWebhookSecret, receiveWebhook } from './webhooks';
import { summarizeDue } from './summaries';
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

async function api(request: Request, env: Env) {
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
    const rows = await env.DB.prepare(
      "SELECT key,value FROM monitor_settings WHERE key IN ('daily_hour','last_cron_at')",
    ).all<{ key: string; value: string }>();
    const values = Object.fromEntries(rows.results.map((row) => [row.key, row.value]));
    return json({
      dailyHour: Number(values.daily_hour ?? 23),
      timezone: 'Asia/Shanghai',
      lastScheduledAt: Number(values.last_cron_at) || null,
      monitors: [{ id: 'stars', source: 'webhook' }],
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
      throw new AppError(400, '汇总时间应为 0–23 时。');
    await env.DB.prepare("UPDATE monitor_settings SET value = ? WHERE key = 'daily_hour'")
      .bind(String(dailyHour))
      .run();
    return json({ ok: true });
  }
  if (path === '/api/repositories' && method === 'POST') {
    const data = await body(request);
    const name = parseRepository(data.repository);
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM projects').first<{
      count: number;
    }>();
    if ((count?.count ?? 0) >= 20) throw new AppError(400, '最多监控 20 个仓库。');
    const id = crypto.randomUUID();
    const secret = newWebhookSecret();
    const sealed = await sealWebhookSecret(env, id, secret);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO projects(id,full_name,created_at) VALUES (?,?,?)').bind(
          id,
          name,
          nowSeconds(),
        ),
        secretStatement(env.DB, id, sealed),
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new AppError(409, '这个仓库已经在监控中了。');
      throw error;
    }
    return json(webhookConfig(url.origin, id, name, secret), 201);
  }
  const repository = path.match(/^\/api\/repositories\/([^/]+)(?:\/(webhook))?$/);
  if (repository) {
    const id = repository[1];
    const project = await env.DB.prepare('SELECT full_name FROM projects WHERE id = ?')
      .bind(id)
      .first<{ full_name: string }>();
    if (!project) throw new AppError(404, '仓库不存在。');
    if (repository[2] === 'webhook') {
      if (method === 'GET') return json(webhookConfig(url.origin, id, project.full_name));
      if (method === 'POST') {
        const secret = newWebhookSecret();
        await secretStatement(env.DB, id, await sealWebhookSecret(env, id, secret)).run();
        return json(webhookConfig(url.origin, id, project.full_name, secret));
      }
    } else {
      if (method === 'PATCH') {
        const { enabled } = await body(request);
        if (typeof enabled !== 'boolean') throw new AppError(400, '监控开关无效。');
        await env.DB.prepare('UPDATE projects SET enabled=? WHERE id=?')
          .bind(Number(enabled), id)
          .run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run();
        return json({ ok: true });
      }
    }
  }
  throw new AppError(404, '接口不存在。');
}

function webhookConfig(origin: string, id: string, name: string, secret?: string) {
  return {
    id,
    full_name: name,
    url: `${origin}/hooks/github/${id}`,
    secret,
    settingsUrl: `https://github.com/${name}/settings/hooks`,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    try {
      const path = new URL(request.url).pathname;
      const hook = path.match(/^\/hooks\/github\/([^/]+)$/);
      response = hook
        ? await receiveWebhook(request, env, hook[1])
        : path.startsWith('/api/')
          ? await api(request, env)
          : await env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof AppError) response = json({ error: error.message }, error.status);
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
    if (/^\/(api|hooks)\//.test(new URL(request.url).pathname))
      secured.headers.set('Cache-Control', 'no-store');
    if (new URL(request.url).protocol === 'https:')
      secured.headers.set('Strict-Transport-Security', 'max-age=31536000');
    return secured;
  },
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await initDB(env.DB);
    await env.DB.prepare(
      "INSERT INTO monitor_settings(key,value) VALUES ('last_cron_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
      .bind(String(nowSeconds()))
      .run();
    await summarizeDue(env.DB);
  },
} satisfies ExportedHandler<Env>;
