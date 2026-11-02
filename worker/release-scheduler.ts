import { DurableObject } from 'cloudflare:workers';
import { initDB } from './db';
import { collectProjectReleases, readCollectionSchedule } from './public-releases';
import type { Env } from './types';

// One object per project. D1 owns the due time and lease; alarms only wake it up.
export class ReleaseScheduler extends DurableObject<Env> {
  async ensureScheduled(projectId: string) {
    await this.ctx.blockConcurrencyWhile(async () => {
      if ((await this.ctx.storage.getAlarm()) !== null) return;
      const project = await readCollectionSchedule(this.env, projectId);
      if (!project) return;
      await this.ctx.storage.put('project', projectId);
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 1000, project.next_at, project.lease_until * 1000),
      );
    });
  }

  async alarm() {
    const projectId = await this.ctx.storage.get<string>('project');
    if (!projectId) return;
    // Persist a recovery wake-up before doing network I/O. If the object is
    // interrupted after D1 commits, the next attempt still reads its due time.
    await this.ctx.storage.setAlarm(Date.now() + 35000);
    try {
      await initDB(this.env.DB);
      const project = await readCollectionSchedule(this.env, projectId);
      const next = project ? await collectProjectReleases(this.env, project) : null;
      if (next === null) {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.delete('project');
        return;
      }
      await this.ctx.storage.setAlarm(next);
    } catch (error) {
      console.error({
        event: 'release_schedule_error',
        projectId,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      // Explicitly re-arm: the platform's default alarm retries are bounded.
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }
}

export async function ensureReleaseSchedules(env: Env) {
  const projects = await env.DB.prepare('SELECT id FROM projects WHERE enabled=1').all<{
    id: string;
  }>();
  const results = await Promise.allSettled(
    projects.results.map(({ id }) => env.RELEASE_SCHEDULER.getByName(id).ensureScheduled(id)),
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected')
      console.error({ event: 'release_schedule_start_failed', projectId: projects.results[i].id });
  }
}
