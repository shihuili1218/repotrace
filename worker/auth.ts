import { AppError, nowSeconds } from './types';

const ITERATIONS = 100_000; // Workers Web Crypto supports up to 100,000 PBKDF2 iterations.
const TTL = 7 * 86400;
const hex = (value: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(value))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const bytes = (value: string) =>
  Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
const encoder = new TextEncoder();

export async function digest(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
export async function passwordHash(password: string, salt: string, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return hex(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations },
      key,
      256,
    ),
  );
}
export function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256)
    throw new AppError(400, '密码需为 12–256 个字符。');
}
export async function newPassword(password: string) {
  validatePassword(password);
  const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { hash: await passwordHash(password, salt), salt, iterations: ITERATIONS };
}

export async function authenticated(request: Request, db: D1Database) {
  const token = request.headers
    .get('Cookie')
    ?.match(/(?:^|;\s*)repotrace_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return false;
  return !!(await db
    .prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await digest(token), nowSeconds())
    .first());
}
export async function createSession(db: D1Database, request: Request) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowSeconds()),
    db
      .prepare('INSERT INTO sessions(token_hash,expires_at) VALUES (?,?)')
      .bind(await digest(token), nowSeconds() + TTL),
  ]);
  return cookie(request, token, TTL);
}
export function cookie(request: Request, value = '', maxAge = 0) {
  return `repotrace_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function logout(request: Request, db: D1Database) {
  const token = request.headers.get('Cookie')?.match(/repotrace_session=([a-f0-9]{64})/)?.[1];
  if (token)
    await db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await digest(token))
      .run();
}
export async function rateLimit(request: Request, db: D1Database) {
  const key = await digest(request.headers.get('CF-Connecting-IP') ?? 'local');
  const now = nowSeconds();
  await db.prepare('DELETE FROM login_limits WHERE expires_at <= ?').bind(now).run();
  const row = await db
    .prepare(
      `INSERT INTO login_limits(key,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`,
    )
    .bind(key, now + 900)
    .first<{ attempts: number }>();
  if (row && row.attempts > 10) throw new AppError(429, '尝试次数过多，请在 15 分钟后重试。');
}
export async function verifyPassword(db: D1Database, password: unknown) {
  const admin = await db
    .prepare('SELECT * FROM admin WHERE id = 1')
    .first<{ hash: string; salt: string; iterations: number }>();
  if (!admin) throw new AppError(409, '请先设置管理员密码。');
  const input = typeof password === 'string' && password.length <= 256 ? password : '';
  const valid = constantTimeEqual(
    await passwordHash(input, admin.salt, admin.iterations),
    admin.hash,
  );
  if (!valid) throw new AppError(401, '密码不正确。');
}
