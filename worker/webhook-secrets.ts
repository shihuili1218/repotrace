import { AppError, type Env, nowSeconds } from './types';

interface SealedSecret {
  keyId: string;
  ciphertext: string;
}
const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function storage(env: Env) {
  if (!env.WEBHOOK_KEYS)
    throw new AppError(503, 'Webhook Secret 安全存储未就绪，请确认部署已创建 WEBHOOK_KEYS 绑定。');
  return env.WEBHOOK_KEYS;
}

async function loadKey(env: Env, id: string) {
  let pending = keyCache.get(id);
  if (!pending) {
    pending = (async () => {
      const raw = await storage(env).get(`vault/${id}`, 'arrayBuffer');
      if (!raw)
        throw new AppError(
          503,
          'Webhook Secret 的加密密钥无法读取，请检查 WEBHOOK_KEYS 是否仍绑定原有的 KV 命名空间。',
        );
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    })();
    keyCache.set(id, pending);
    pending.catch(() => {
      if (keyCache.get(id) === pending) keyCache.delete(id);
    });
  }
  return pending;
}

async function writeKey(env: Env) {
  const existing = await env.DB.prepare(
    "SELECT value FROM monitor_settings WHERE key = 'webhook_vault_key'",
  ).first<{ value: string }>();
  if (existing) return { id: existing.value, key: await loadKey(env, existing.value) };
  const id = crypto.randomUUID();
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await storage(env).put(`vault/${id}`, raw);
  // D1 chooses one immutable root key atomically. Candidates have distinct KV names,
  // so concurrent first writes cannot overwrite a key already used by another project.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO monitor_settings(key,value) VALUES ('webhook_vault_key',?)",
  )
    .bind(id)
    .run();
  const chosen = await env.DB.prepare(
    "SELECT value FROM monitor_settings WHERE key = 'webhook_vault_key'",
  ).first<{ value: string }>();
  if (!chosen) throw new AppError(503, 'Webhook Secret 安全存储初始化失败，请稍后重试。');
  if (chosen.value !== id) await storage(env).delete(`vault/${id}`);
  else {
    // Use the new material locally while its KV entry propagates to other locations.
    keyCache.set(id, crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return { id: chosen.value, key: await loadKey(env, chosen.value) };
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function sealWebhookSecret(
  env: Env,
  repoId: string,
  secret: string,
): Promise<SealedSecret> {
  const { id, key } = await writeKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(repoId) },
    key,
    encoder.encode(secret),
  );
  return { keyId: id, ciphertext: `v1.${base64(iv)}.${base64(new Uint8Array(ciphertext))}` };
}

export function secretStatement(db: D1Database, repoId: string, sealed: SealedSecret) {
  return db
    .prepare(
      `INSERT INTO webhook_connections(project_id,key_id,ciphertext,configured_at) VALUES (?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET key_id=excluded.key_id,ciphertext=excluded.ciphertext,configured_at=excluded.configured_at,last_received_at=NULL`,
    )
    .bind(repoId, sealed.keyId, sealed.ciphertext, nowSeconds());
}

export async function getWebhookCredentials(
  env: Env,
  repoId: string,
): Promise<{ secret: string; version: string } | null> {
  const record = await env.DB.prepare(
    'SELECT key_id,ciphertext FROM webhook_connections WHERE project_id = ?',
  )
    .bind(repoId)
    .first<{ key_id: string; ciphertext: string }>();
  if (!record) return null;
  const key = await loadKey(env, record.key_id);
  try {
    const [version, iv, ciphertext] = record.ciphertext.split('.');
    if (version !== 'v1' || !iv || !ciphertext) throw new Error('Invalid ciphertext');
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(repoId) },
      key,
      fromBase64(ciphertext),
    );
    return { secret: new TextDecoder().decode(plaintext), version: record.ciphertext };
  } catch {
    throw new AppError(503, '此 Webhook Secret 无法解密，请在监控项目中重新生成签名密钥。');
  }
}
