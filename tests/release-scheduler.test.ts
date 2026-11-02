/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as bindings } from 'cloudflare:workers';
import { runInDurableObject, runDurableObjectAlarm, abortAllDurableObjects } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../worker';
import { initDB } from '../worker/db';
import type { Env } from '../worker/types';

const env = bindings as unknown as Env;
let now: number;
beforeEach(async () => {
  now = Date.UTC(2100, 0, 1);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  await initDB(env.DB);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM projects'),
    env.DB.prepare('DELETE FROM public_api_backoff'),
  ]);
});
afterEach(() => vi.restoreAllMocks());

async function project() {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO projects(id,full_name,created_at) VALUES (?,?,?)')
    .bind(id, `owner/${id}`, Math.floor(now / 1000))
    .run();
  return { id, stub: env.RELEASE_SCHEDULER.getByName(id) };
}
async function alarmAt(stub: ReturnType<Env['RELEASE_SCHEDULER']['getByName']>) {
  return runInDurableObject(stub, (_, state) => state.storage.getAlarm());
}

it('cron only starts missing project alarms and does not query GitHub', async () => {
  const { stub } = await project();
  const outgoing = vi.spyOn(globalThis, 'fetch');
  await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);
  const first = await alarmAt(stub);
  expect(first).toBe(now + 1000);
  now += 100;
  await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);
  expect(await alarmAt(stub)).toBe(first);
  expect(outgoing).not.toHaveBeenCalled();
});

it('retries failures after a second and schedules an hour from successful completion', async () => {
  const { id, stub } = await project();
  const outgoing = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    now += 400;
    return Response.json(
      { message: 'API rate limit exceeded.' },
      {
        status: 403,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(now / 1000) + 3600),
        },
      },
    );
  });
  await stub.ensureScheduled(id);
  await runDurableObjectAlarm(stub);
  const retryAt = now + 1000;
  expect(await alarmAt(stub)).toBe(retryAt);
  now = retryAt - 1;
  await runDurableObjectAlarm(stub);
  expect(outgoing).toHaveBeenCalledTimes(1);
  outgoing.mockImplementation(async () => {
    now += 700;
    return Response.json([]);
  });
  now = retryAt;
  await runDurableObjectAlarm(stub);
  const nextAt = now + 3600000;
  expect(await alarmAt(stub)).toBe(nextAt);
  expect(outgoing).toHaveBeenCalledTimes(2);
  now = nextAt - 1;
  await runDurableObjectAlarm(stub);
  expect(outgoing).toHaveBeenCalledTimes(2);
  now = nextAt;
  await runDurableObjectAlarm(stub);
  expect(outgoing).toHaveBeenCalledTimes(3);
});

it('recovers a missing alarm from D1 after interruption without advancing the next collection', async () => {
  const { id, stub } = await project();
  const outgoing = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json([]));
  await stub.ensureScheduled(id);
  await runDurableObjectAlarm(stub);
  const nextAt = await alarmAt(stub);
  expect(nextAt).toBe(now + 3600000);
  await runInDurableObject(stub, (_, state) => state.storage.deleteAlarm());
  await abortAllDurableObjects();
  const restarted = env.RELEASE_SCHEDULER.getByName(id);
  now += 60000;
  await restarted.ensureScheduled(id);
  expect(await alarmAt(restarted)).toBe(nextAt);
  await runDurableObjectAlarm(restarted);
  expect(outgoing).toHaveBeenCalledTimes(1);
  expect(await alarmAt(restarted)).toBe(nextAt);
});

it.each(['paused', 'deleted'])('stops alarms when a project is %s', async (change) => {
  const { id, stub } = await project();
  const outgoing = vi.spyOn(globalThis, 'fetch');
  await stub.ensureScheduled(id);
  await env.DB.prepare(
    change === 'paused'
      ? 'UPDATE projects SET enabled=0 WHERE id=?'
      : 'DELETE FROM projects WHERE id=?',
  )
    .bind(id)
    .run();
  await runDurableObjectAlarm(stub);
  expect(await alarmAt(stub)).toBeNull();
  expect(outgoing).not.toHaveBeenCalled();
});
