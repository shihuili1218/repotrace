import { initDB } from './db';
import { getWebhookCredentials } from './webhook-secrets';
import { parseRepository } from './projects';
import { webhookEvents } from '../shared/monitors';
import { normalizeEvent, object, integer, count } from './events';
import { AppError, type Env, json, nowSeconds } from './types';

export const newWebhookSecret = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');

async function rawBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const limit = 1024 * 1024;
  if (Number(request.headers.get('Content-Length') ?? 0) > limit)
    throw new AppError(413, 'Webhook 内容过大。');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'Webhook 内容为空。');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError(413, 'Webhook 内容过大。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export async function receiveWebhook(request: Request, env: Env, id: string) {
  if (request.method !== 'POST') throw new AppError(405, '请使用 POST。');
  await initDB(env.DB);
  const signature = request.headers.get('X-Hub-Signature-256') ?? '';
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) throw new AppError(401, 'Webhook 签名无效。');
  const credentials = await getWebhookCredentials(env, id);
  if (!credentials) throw new AppError(401, 'Webhook 签名无效。');
  const raw = await rawBody(request);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(credentials.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = Uint8Array.from(signature.slice(7).match(/../g)!, (hex) => parseInt(hex, 16));
  if (!(await crypto.subtle.verify('HMAC', key, signed, raw)))
    throw new AppError(401, 'Webhook 签名无效。');
  const event = request.headers.get('X-GitHub-Event');
  // Existing installations may still deliver Release events. Accept those for
  // compatibility; new setups read the public catalog on demand instead.
  if (
    event !== 'ping' &&
    event !== 'release' &&
    !webhookEvents.some((item) => item.event === event)
  )
    return json({ ok: true, ignored: true });
  const delivery = request.headers.get('X-GitHub-Delivery') ?? '';
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(delivery)) throw new AppError(400, '缺少有效的 Delivery ID。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new AppError(400, 'Webhook JSON 无效。');
  }
  const data = object(parsed);
  const repo = object(data.repository);
  const githubId = integer(repo.id);
  const name = parseRepository(repo.full_name);
  const stars = count(repo.stargazers_count);
  const forks = count(repo.forks_count);
  const at = nowSeconds();
  const normalized = normalizeEvent(event!, data, name, at);
  const project = await env.DB.prepare(
    'SELECT github_id,full_name,enabled FROM projects WHERE id = ?',
  )
    .bind(id)
    .first<{ github_id: number | null; full_name: string; enabled: number }>();
  if (
    !project ||
    (project.github_id !== null
      ? project.github_id !== githubId
      : project.full_name.toLowerCase() !== name.toLowerCase())
  )
    throw new AppError(409, 'Webhook 仓库与此项目不匹配。');
  // The delivery marker and every state/event update commit together.
  const fresh = `EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0)`;
  const statements = [
    env.DB.prepare(
      'UPDATE projects SET github_id=?,full_name=?,description=?,language=? WHERE id=? AND (github_id IS NULL OR github_id=?) AND NOT EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=1) AND EXISTS(SELECT 1 FROM webhook_connections WHERE project_id=? AND ciphertext=?)',
    ).bind(
      githubId,
      name,
      typeof repo.description === 'string' ? repo.description.slice(0, 2000) : '',
      typeof repo.language === 'string' ? repo.language.slice(0, 100) : null,
      id,
      githubId,
      id,
      delivery,
      id,
      credentials.version,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_deliveries(project_id,delivery_id,event_name,received_at,observed_total,observed_forks,recorded)
      SELECT p.id,?,?,?,?,?,p.enabled FROM projects p JOIN webhook_connections c ON c.project_id=p.id WHERE p.id=? AND p.github_id=? AND c.ciphertext=?`,
    ).bind(delivery, event, at, stars ?? -1, forks, id, githubId, credentials.version),
    // A valid redelivery confirms the current signing secret, even when its effects
    // were already recorded. This also makes re-delivered Ping useful after rotation.
    env.DB.prepare(
      `UPDATE webhook_connections SET first_received_at=MIN(COALESCE(first_received_at,?),?),last_received_at=MAX(COALESCE(last_received_at,?),?) WHERE project_id=? AND ciphertext=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND github_id=?)`,
    ).bind(at, at, at, at, id, credentials.version, id, githubId),
  ];
  if (normalized) {
    statements.push(...normalized.statements(env.DB, id, delivery, at));
    if (normalized.category !== 'star')
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO project_events(delivery_seq,project_id,category,action,object_id,actor_id,actor_login,title,number,url,received_at)
      SELECT seq,project_id,?,?,?,?,?,?,?,?,received_at FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0 AND recorded=1`,
        ).bind(
          normalized.category,
          normalized.action,
          normalized.objectId,
          normalized.actor.id,
          normalized.actor.login,
          normalized.title,
          normalized.number,
          normalized.url,
          id,
          delivery,
        ),
      );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE webhook_connections SET
      last_star_at=CASE WHEN ?='star' THEN MAX(COALESCE(last_star_at,?),?) ELSE last_star_at END,
      current_total=CASE WHEN ? IS NOT NULL AND ?>=COALESCE(total_reported_at,0) THEN ? ELSE current_total END,
      total_reported_at=CASE WHEN ? IS NOT NULL THEN MAX(COALESCE(total_reported_at,?),?) ELSE total_reported_at END,
      current_forks=CASE WHEN ? IS NOT NULL AND ?>=COALESCE(forks_reported_at,0) THEN ? ELSE current_forks END,
      forks_reported_at=CASE WHEN ? IS NOT NULL THEN MAX(COALESCE(forks_reported_at,?),?) ELSE forks_reported_at END
      WHERE project_id=? AND ${fresh}
      AND EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND recorded=1)`,
    ).bind(
      event,
      at,
      at,
      stars,
      at,
      stars,
      stars,
      at,
      at,
      forks,
      at,
      forks,
      forks,
      at,
      at,
      id,
      id,
      delivery,
      id,
      delivery,
    ),
    env.DB.prepare(
      'UPDATE webhook_deliveries SET processed=1 WHERE project_id=? AND delivery_id=?',
    ).bind(id, delivery),
  );
  const results = await env.DB.batch(statements);
  if (!results[2].meta.changes) throw new AppError(401, 'Webhook 密钥已更换，请用新密钥重新投递。');
  return json({ ok: true, paused: !project.enabled });
}
