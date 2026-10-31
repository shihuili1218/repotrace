import { initDB } from './db';
import { getWebhookCredentials } from './webhook-secrets';
import { parseRepository } from './projects';
import { localDay } from './summaries';
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
  if (event !== 'ping' && event !== 'star') return json({ ok: true, ignored: true });
  const delivery = request.headers.get('X-GitHub-Delivery') ?? '';
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(delivery)) throw new AppError(400, '缺少有效的 Delivery ID。');
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new AppError(400, 'Webhook JSON 无效。');
  }
  const repo = data?.repository;
  if (
    !Number.isSafeInteger(repo?.id) ||
    repo.id <= 0 ||
    !Number.isSafeInteger(repo.stargazers_count) ||
    repo.stargazers_count < 0
  )
    throw new AppError(400, 'Webhook 缺少仓库及 Star 总量。');
  const name = parseRepository(repo.full_name);
  const project = await env.DB.prepare(
    'SELECT github_id,full_name,enabled FROM projects WHERE id = ?',
  )
    .bind(id)
    .first<{ github_id: number | null; full_name: string; enabled: number }>();
  if (
    !project ||
    (project.github_id !== null
      ? project.github_id !== repo.id
      : project.full_name.toLowerCase() !== name.toLowerCase())
  )
    throw new AppError(409, 'Webhook 仓库与此项目不匹配。');
  const sender = data.sender;
  if (
    event === 'star' &&
    (!['created', 'deleted'].includes(data.action) ||
      !Number.isSafeInteger(sender?.id) ||
      sender.id <= 0 ||
      typeof sender.login !== 'string' ||
      !/^[a-zA-Z0-9-]{1,39}(?:\[bot\])?$/.test(sender.login))
  )
    throw new AppError(400, 'Star 事件内容无效。');
  const starredAt =
    event === 'star' &&
    data.action === 'created' &&
    typeof data.starred_at === 'string' &&
    Number.isFinite(Date.parse(data.starred_at))
      ? data.starred_at
      : null;
  const at = nowSeconds();
  // All effects, including the deduplication marker, commit together. Retries cannot
  // lose a user event between accepting a delivery and updating the counters.
  const fresh = `EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0)`;
  const statements = [
    env.DB.prepare(
      'UPDATE projects SET github_id=?,full_name=?,description=?,language=? WHERE id=? AND (github_id IS NULL OR github_id=?) AND NOT EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=1) AND EXISTS(SELECT 1 FROM webhook_connections WHERE project_id=? AND ciphertext=?)',
    ).bind(
      repo.id,
      name,
      typeof repo.description === 'string' ? repo.description.slice(0, 2000) : '',
      typeof repo.language === 'string' ? repo.language.slice(0, 100) : null,
      id,
      repo.id,
      id,
      delivery,
      id,
      credentials.version,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO webhook_deliveries(project_id,delivery_id,event_name,received_at,observed_total,recorded)
      SELECT p.id,?,?,?,?,p.enabled FROM projects p JOIN webhook_connections c ON c.project_id=p.id WHERE p.id=? AND p.github_id=? AND c.ciphertext=?`,
    ).bind(delivery, event, at, repo.stargazers_count, id, repo.id, credentials.version),
    // A valid redelivery confirms the current signing secret, even when its effects
    // were already recorded. This also makes re-delivered Ping useful after rotation.
    env.DB.prepare(
      `UPDATE webhook_connections SET first_received_at=MIN(COALESCE(first_received_at,?),?),last_received_at=MAX(COALESCE(last_received_at,?),?) WHERE project_id=? AND ciphertext=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND github_id=?)`,
    ).bind(at, at, at, at, id, credentials.version, id, repo.id),
  ];
  if (event === 'star')
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO star_events(delivery_seq,project_id,user_id,login,kind,starred_at,received_at)
    SELECT seq,project_id,?,?,?,?,received_at FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND processed=0 AND recorded=1`,
      ).bind(
        sender.id,
        sender.login,
        data.action === 'created' ? 'added' : 'removed',
        starredAt,
        id,
        delivery,
      ),
    );
  statements.push(
    env.DB.prepare(
      `UPDATE webhook_connections SET
      first_received_at=MIN(COALESCE(first_received_at,?),?),last_received_at=MAX(COALESCE(last_received_at,?),?),
      last_star_at=CASE WHEN ?='star' AND EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND recorded=1) THEN MAX(COALESCE(last_star_at,?),?) ELSE last_star_at END,
      current_total=CASE WHEN ?>=COALESCE(total_reported_at,0) AND EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND recorded=1) THEN ? ELSE current_total END,
      total_reported_at=CASE WHEN EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND recorded=1) THEN MAX(COALESCE(total_reported_at,?),?) ELSE total_reported_at END
      WHERE project_id=? AND ${fresh}`,
    ).bind(
      at,
      at,
      at,
      at,
      event,
      id,
      delivery,
      at,
      at,
      at,
      id,
      delivery,
      repo.stargazers_count,
      id,
      delivery,
      at,
      at,
      id,
      id,
      delivery,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO summaries(id,project_id,kind,source,day,period_start,period_end,computed_at,total)
      SELECT ?,?,'baseline','webhook',?,?,?, ?,? WHERE ${fresh}
      AND NOT EXISTS(SELECT 1 FROM summaries WHERE project_id=? AND source='webhook' AND kind='baseline')
      AND EXISTS(SELECT 1 FROM webhook_deliveries WHERE project_id=? AND delivery_id=? AND recorded=1)`,
    ).bind(
      crypto.randomUUID(),
      id,
      localDay(at),
      at,
      at,
      at,
      repo.stargazers_count,
      id,
      delivery,
      id,
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
