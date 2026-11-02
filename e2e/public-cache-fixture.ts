import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Only the disposable Playwright database can be seeded. Never use developer or
// deployed state; release webhooks no longer populate the public API cache.
export function seedPublicCache(project: string, raw: Record<string, unknown>) {
  const root = process.env.REPOTRACE_E2E_STATE;
  if (!root || !root.includes('repotrace-browser-'))
    throw new Error('Missing disposable browser state');
  const paths = readdirSync(root, { recursive: true }).filter(
    (p) => typeof p === 'string' && p.endsWith('.sqlite'),
  );
  for (const path of paths) {
    const db = new DatabaseSync(join(root, String(path)));
    try {
      db.exec('PRAGMA busy_timeout=5000');
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='releases'").get())
        continue;
      const now = Math.floor(Date.now() / 1000);
      const at = (value: unknown) =>
        typeof value === 'string' ? Math.floor(Date.parse(value) / 1000) : null;
      const author = raw.author as { login?: string } | undefined;
      const assets = raw.assets as Record<string, unknown>[] | undefined;
      db.prepare(
        `INSERT INTO releases(project_id,github_id,tag_name,name,author_login,prerelease,draft,created_at,published_at,first_seen_at,last_delivery_seq,metadata_observed_at,assets_seen_at,assets_source)
        VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?) ON CONFLICT(project_id,github_id) DO UPDATE SET published_at=excluded.published_at`,
      ).run(
        project,
        Number(raw.id),
        String(raw.tag_name),
        String(raw.name ?? raw.tag_name),
        author?.login ?? 'octocat',
        Number(!!raw.prerelease),
        Number(!!raw.draft),
        at(raw.created_at) ?? now,
        at(raw.published_at),
        now,
        now,
        assets ? now : null,
        assets ? 'github' : null,
      );
      if (assets)
        for (const asset of assets)
          db.prepare(
            `INSERT OR REPLACE INTO release_assets(project_id,release_id,github_id,name,size,content_type,state,download_count,download_url,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            project,
            Number(raw.id),
            Number(asset.id),
            String(asset.name),
            Number(asset.size),
            String(asset.content_type),
            String(asset.state),
            asset.download_count === null ? null : Number(asset.download_count),
            String(asset.browser_download_url),
            now,
          );
      return;
    } finally {
      db.close();
    }
  }
  throw new Error('Disposable D1 database not found');
}
