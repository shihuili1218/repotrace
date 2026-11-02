// Versioned, additive migrations run on first API/webhook access. No deployment-time SQL step.
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
  [], // Version 2 was used by the retired polling implementation.
  [
    `CREATE TABLE projects (id TEXT PRIMARY KEY, github_id INTEGER UNIQUE, full_name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL DEFAULT '', language TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
    `INSERT INTO projects SELECT * FROM repositories`,
    `CREATE TABLE webhook_connections (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL, ciphertext TEXT NOT NULL, configured_at INTEGER NOT NULL,
      first_received_at INTEGER, last_received_at INTEGER, last_star_at INTEGER,
      current_total INTEGER, total_reported_at INTEGER
    )`,
    `CREATE TABLE webhook_deliveries (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      delivery_id TEXT NOT NULL, event_name TEXT NOT NULL, received_at INTEGER NOT NULL,
      observed_total INTEGER NOT NULL, recorded INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id,delivery_id)
    )`,
    `CREATE INDEX delivery_period ON webhook_deliveries(project_id,received_at,seq)`,
    `CREATE INDEX delivery_sequence ON webhook_deliveries(project_id,seq)`,
    `CREATE TABLE star_events (
      delivery_seq INTEGER PRIMARY KEY REFERENCES webhook_deliveries(seq) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL, login TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('added','removed')),
      starred_at TEXT, received_at INTEGER NOT NULL
    )`,
    `CREATE INDEX event_period ON star_events(project_id,received_at,delivery_seq)`,
    `CREATE TABLE summaries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, source TEXT NOT NULL, day TEXT NOT NULL,
      period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, computed_at INTEGER NOT NULL,
      total INTEGER, added INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0, delivery_cursor INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id,source,kind,day)
    )`,
    `CREATE INDEX summary_history ON summaries(project_id,period_end)`,
    `CREATE TABLE summary_changes (
      summary_id TEXT NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL, login TEXT NOT NULL, kind TEXT NOT NULL, starred_at TEXT,
      observed_at INTEGER NOT NULL, PRIMARY KEY(summary_id,user_id)
    )`,
    `INSERT INTO summaries(id,project_id,kind,source,day,period_start,period_end,computed_at,total,added,removed)
      SELECT id,repo_id,kind,'legacy',day,started_at,COALESCE(completed_at,started_at),COALESCE(completed_at,started_at),total,added,removed
      FROM snapshots WHERE status = 'complete'`,
    `INSERT INTO summary_changes SELECT c.snapshot_id,c.user_id,c.login,c.kind,c.starred_at,s.period_end
      FROM star_changes c JOIN summaries s ON s.id = c.snapshot_id`,
    `DROP TABLE IF EXISTS repository_tokens`,
    `DELETE FROM monitor_settings WHERE key = 'token_vault_key'`,
    `DROP TABLE snapshot_members`,
    `DROP TABLE star_changes`,
    `DROP TABLE snapshots`,
    `DROP TABLE repositories`,
  ],
  [
    `ALTER TABLE webhook_deliveries ADD COLUMN observed_forks INTEGER`,
    `ALTER TABLE webhook_connections ADD COLUMN current_forks INTEGER`,
    `ALTER TABLE webhook_connections ADD COLUMN forks_reported_at INTEGER`,
    `CREATE TABLE project_events (
      delivery_seq INTEGER PRIMARY KEY REFERENCES webhook_deliveries(seq) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL, action TEXT NOT NULL, object_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL, actor_login TEXT NOT NULL, title TEXT NOT NULL,
      number INTEGER, url TEXT NOT NULL, received_at INTEGER NOT NULL
    )`,
    `CREATE INDEX activity_period ON project_events(project_id,received_at,category,action)`,
    `CREATE TABLE forks (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, github_id INTEGER NOT NULL,
      full_name TEXT NOT NULL, owner_id INTEGER NOT NULL, owner_login TEXT NOT NULL,
      created_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
      PRIMARY KEY(project_id,github_id)
    )`,
    `CREATE INDEX forks_received ON forks(project_id,received_at)`,
    `CREATE TABLE work_items (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      github_id INTEGER NOT NULL, kind TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL,
      author_id INTEGER NOT NULL, author_login TEXT NOT NULL, state TEXT NOT NULL, draft INTEGER NOT NULL DEFAULT 0,
      labels TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER, merged_at INTEGER,
      first_seen_at INTEGER NOT NULL, first_reply_at INTEGER, review_state TEXT, reviewed_at INTEGER, head_sha TEXT,
      last_delivery_seq INTEGER NOT NULL, PRIMARY KEY(project_id,kind,github_id), UNIQUE(project_id,kind,number)
    )`,
    `CREATE INDEX work_status ON work_items(project_id,kind,state,updated_at)`,
    `CREATE TABLE releases (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, github_id INTEGER NOT NULL,
      tag_name TEXT NOT NULL, name TEXT NOT NULL, author_login TEXT NOT NULL,
      prerelease INTEGER NOT NULL, draft INTEGER NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER,
      published_received_at INTEGER, deleted_at INTEGER, first_seen_at INTEGER NOT NULL, last_delivery_seq INTEGER NOT NULL,
      PRIMARY KEY(project_id,github_id)
    )`,
    `CREATE INDEX release_history ON releases(project_id,published_at)`,
    `DELETE FROM monitor_settings WHERE key IN ('daily_hour','last_cron_at')`,
  ],
  [
    `ALTER TABLE releases ADD COLUMN metadata_observed_at INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE releases ADD COLUMN assets_seen_at INTEGER`,
    `ALTER TABLE releases ADD COLUMN assets_source TEXT`,
    `ALTER TABLE releases ADD COLUMN assets_snapshot_id TEXT`,
    `UPDATE releases SET metadata_observed_at=COALESCE((SELECT received_at FROM webhook_deliveries WHERE seq=releases.last_delivery_seq),first_seen_at)`,
    `CREATE TABLE release_assets (
      project_id TEXT NOT NULL, release_id INTEGER NOT NULL, github_id INTEGER NOT NULL,
      name TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL, state TEXT NOT NULL,
      download_count INTEGER, download_url TEXT, observed_at INTEGER NOT NULL,
      PRIMARY KEY(project_id,release_id,github_id),
      FOREIGN KEY(project_id,release_id) REFERENCES releases(project_id,github_id) ON DELETE CASCADE
    )`,
    `CREATE TABLE release_catalog_sync (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      last_page INTEGER NOT NULL, next_page INTEGER, updated_at INTEGER NOT NULL
    )`,
  ],
  [
    `ALTER TABLE release_assets ADD COLUMN download_display TEXT`,
    `CREATE TABLE release_refresh (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, resource TEXT NOT NULL,
      updated_at INTEGER, error TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, payload TEXT,
      PRIMARY KEY(project_id,resource)
    )`,
    `CREATE TABLE public_api_backoff (host TEXT PRIMARY KEY, retry_at INTEGER NOT NULL, error TEXT NOT NULL)`,
  ],
  [
    // Retire third-party counts without deleting project or release metadata.
    `DELETE FROM release_refresh WHERE resource='downloads' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.source') END='shields'`,
    `DELETE FROM release_refresh WHERE EXISTS(SELECT 1 FROM releases r WHERE r.project_id=release_refresh.project_id AND release_refresh.resource='assets:'||r.github_id AND r.assets_source='shields')`,
    `UPDATE release_assets SET download_count=NULL WHERE EXISTS(SELECT 1 FROM releases r WHERE r.project_id=release_assets.project_id AND r.github_id=release_assets.release_id AND r.assets_source='shields')`,
    `UPDATE releases SET assets_seen_at=NULL,assets_source=NULL,assets_snapshot_id=NULL WHERE assets_source='shields'`,
    `ALTER TABLE release_assets DROP COLUMN download_display`,
  ],
  [
    `CREATE TABLE download_snapshots (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      hour INTEGER NOT NULL, observed_at INTEGER NOT NULL, total TEXT NOT NULL,
      PRIMARY KEY(project_id,hour)
    )`,
    `CREATE INDEX download_history ON download_snapshots(project_id,observed_at)`,
    `ALTER TABLE release_refresh ADD COLUMN scheduled_hour INTEGER`,
    `DELETE FROM release_refresh WHERE resource LIKE 'catalog:%'`,
    `DROP TABLE release_catalog_sync`,
    // Keep the last successful totals; old visit-driven retry state no longer applies.
    `UPDATE release_refresh SET error=NULL,retry_at=0,lease_token=NULL,lease_until=0 WHERE resource='downloads'`,
    `UPDATE public_api_backoff SET error='GitHub 公开接口暂时不可用。'`,
  ],
  [
    // PR comments carry an Issue ID, while PR/review events carry a PR ID.
    // Their repository-local number is the common identity across both sources.
    `CREATE TABLE work_items_number (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      github_id INTEGER NOT NULL, kind TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL,
      author_id INTEGER NOT NULL, author_login TEXT NOT NULL, state TEXT NOT NULL, draft INTEGER NOT NULL DEFAULT 0,
      labels TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER, merged_at INTEGER,
      first_seen_at INTEGER NOT NULL, first_reply_at INTEGER, review_state TEXT, reviewed_at INTEGER, head_sha TEXT,
      last_delivery_seq INTEGER NOT NULL, PRIMARY KEY(project_id,kind,number)
    )`,
    `INSERT INTO work_items_number SELECT * FROM work_items`,
    `DROP TABLE work_items`,
    `ALTER TABLE work_items_number RENAME TO work_items`,
    `CREATE INDEX work_status ON work_items(project_id,kind,state,updated_at)`,
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
      if (
        !(await db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin'")
          .first())
      ) {
        try {
          await db.batch([
            ...migrations[0]
              .filter((sql) =>
                /^CREATE TABLE IF NOT EXISTS (admin|sessions|login_limits|monitor_settings)\b/.test(
                  sql,
                ),
              )
              .map((sql) => db.prepare(sql)),
            ...migrations[2]
              .filter((sql) => sql.startsWith('CREATE '))
              .map((sql) => db.prepare(sql)),
            ...migrations
              .slice(3)
              .flat()
              .map((sql) => db.prepare(sql)),
            db.prepare(
              `INSERT OR IGNORE INTO schema_migrations(version) VALUES ${migrations.map((_, i) => `(${i + 1})`).join(',')}`,
            ),
          ]);
          return;
        } catch (error) {
          if (
            await db
              .prepare('SELECT 1 FROM schema_migrations WHERE version=?')
              .bind(migrations.length)
              .first()
          )
            return;
          throw error;
        }
      }
      for (let index = 0; index < migrations.length; index++) {
        if (
          await db
            .prepare('SELECT version FROM schema_migrations WHERE version = ?')
            .bind(index + 1)
            .first()
        )
          continue;
        try {
          await db.batch([
            ...migrations[index].map((sql) => db.prepare(sql)),
            db
              .prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (?)')
              .bind(index + 1),
          ]);
        } catch (error) {
          // Another isolate can finish this atomic migration after our version read.
          if (
            !(await db
              .prepare('SELECT 1 FROM schema_migrations WHERE version=?')
              .bind(index + 1)
              .first())
          )
            throw error;
        }
      }
    })();
    initialized.set(db, promise);
    promise.catch(() => initialized.delete(db));
  }
  await promise;
}
