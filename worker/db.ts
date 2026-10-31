// Versioned, additive migrations run on first API/cron access. No deployment-time SQL step.
export const migrations = [
  [
    `CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id = 1), hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, github_id INTEGER NOT NULL UNIQUE, full_name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL, language TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('baseline','daily','manual')), day TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','complete','failed')),
      page INTEGER NOT NULL DEFAULT 1, total INTEGER NOT NULL DEFAULT 0, expected_total INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0,
      comparison_id TEXT, started_at INTEGER NOT NULL, completed_at INTEGER, error TEXT,
      retry_at INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS one_active_snapshot ON snapshots(repo_id) WHERE status = 'collecting'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS one_daily_snapshot ON snapshots(repo_id,day) WHERE kind = 'daily'`,
    `CREATE INDEX IF NOT EXISTS snapshot_history ON snapshots(repo_id,status,started_at DESC)`,
    `CREATE TABLE IF NOT EXISTS snapshot_members (
      snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
      login TEXT NOT NULL, starred_at TEXT, PRIMARY KEY(snapshot_id,user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS star_changes (
      snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, user_id INTEGER NOT NULL,
      login TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('added','removed')), starred_at TEXT,
      PRIMARY KEY(snapshot_id,user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS monitor_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `INSERT OR IGNORE INTO monitor_settings(key,value) VALUES ('daily_hour','23')`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS repository_tokens (
      repo_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL, ciphertext TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `UPDATE snapshots SET error = 'GitHub 暂时限制请求，稍后自动重试。'
      WHERE error LIKE '%GitHub API 额度受限%' OR error LIKE '%配置 GITHUB_TOKEN 提高额度%'`,
  ],
];

const initialized = new WeakMap<D1Database, Promise<void>>();
export async function initDB(db: D1Database) {
  let promise = initialized.get(db);
  if (!promise) {
    promise = (async () => {
      await db
        .prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`)
        .run();
      for (let index = 0; index < migrations.length; index++) {
        if (
          await db
            .prepare('SELECT version FROM schema_migrations WHERE version = ?')
            .bind(index + 1)
            .first()
        )
          continue;
        await db.batch([
          ...migrations[index].map((sql) => db.prepare(sql)),
          db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)').bind(index + 1),
        ]);
      }
    })();
    initialized.set(db, promise);
    promise.catch(() => initialized.delete(db));
  }
  await promise;
}
