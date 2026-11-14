/// <reference types="@cloudflare/vitest-plugin/types" />
import { env as bindings } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { failureCode, failureReason } from '../worker/errors';
import type { Env } from '../worker/types';

const origin = 'https://repotrace.test';
const confidential =
  'SELECT token_hash FROM sessions; password=private-password; token=private-token';

function existingDatabase(failingQuery: (sql: string) => boolean, failure: Error): D1Database {
  return {
    prepare: vi.fn((sql: string) => {
      if (failingQuery(sql)) throw failure;
      // Existing schema/admin rows let a request reach session validation without
      // creating a password, accessing real credentials, or changing a database.
      return {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ exists: 1 }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
    }),
  } as unknown as D1Database;
}

async function send(request: Request, db: D1Database) {
  const context = createExecutionContext();
  const response = await worker.fetch(request, { ...bindings, DB: db } as unknown as Env, context);
  await waitOnExecutionContext(context);
  return response;
}

afterEach(() => vi.restoreAllMocks());

describe('private failure diagnostics', () => {
  it.each([
    ['Cannot perform I/O on behalf of a different request', 'CROSS_REQUEST_IO'],
    ['D1_ERROR: no such table: sessions', 'D1_SCHEMA'],
    ['D1_COLUMN_NOTFOUND: expires_at', 'D1_SCHEMA'],
    ['D1_ERROR: maximum subquery depth exceeded', 'D1_QUERY_DEPTH'],
    ['D1_ERROR: parser stack overflow', 'D1_QUERY_DEPTH'],
    ['D1_ERROR: exceeded daily row read limit', 'D1_LIMIT'],
    ['D1_ERROR: too many SQL variables', 'D1_LIMIT'],
    ['D1_ERROR: database overloaded', 'D1_UNAVAILABLE'],
    ['D1_ERROR: network connection lost', 'D1_UNAVAILABLE'],
    ['D1_TYPE_ERROR: invalid parameter', 'D1_TYPE'],
    ['D1_ERROR: SQLITE_CORRUPT', 'D1_OTHER'],
    ['Unexpected internal exception', 'INTERNAL'],
  ])('classifies nested %s without exposing error text', (message, reason) => {
    const failure = new Error('Operation failed', {
      cause: new Error(`${message}; ${confidential}`),
    });
    expect(failureReason(failure)).toBe(reason);
    expect(failureCode('AUTH_SESSION', failure)).toBe(`AUTH_SESSION/${reason}`);
  });

  it('handles cyclic causes and non-Error exceptions without publishing their content', () => {
    const failure = new Error(confidential);
    failure.cause = failure;
    expect(failureReason(failure)).toBe('INTERNAL');
    for (const thrown of [null, confidential, { message: confidential }, undefined])
      expect(failureCode('API', thrown)).toBe('API/INTERNAL');
  });

  it.each([
    {
      stage: 'INIT_DB',
      reason: 'D1_SCHEMA',
      message: 'D1_ERROR: no such table: schema_migrations',
      query: () => true,
      cookie: false,
    },
    {
      stage: 'AUTH_SESSION',
      reason: 'D1_UNAVAILABLE',
      message: 'D1_ERROR: database overloaded',
      query: (sql: string) => sql.startsWith('SELECT 1 FROM sessions'),
      cookie: true,
    },
  ])(
    'reports $stage with a traceable code while keeping SQL and credentials private',
    async (test) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new Error('D1 operation failed', {
        cause: new Error(`${test.message}; ${confidential}`),
      });
      const db = existingDatabase(test.query, failure);
      const response = await send(
        new Request(`${origin}/api/auth/status`, {
          headers: test.cookie ? { Cookie: `repotrace_session=${'0'.repeat(64)}` } : {},
        }),
        db,
      );
      const data = await response.json<{ error: string; code: string; requestId: string }>();
      const code = `${test.stage}/${test.reason}`;
      expect(response.status).toBe(500);
      expect(data.code).toBe(code);
      expect(data.error).toContain('服务暂时不可用');
      expect(data.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(response.headers.get('X-RepoTrace-Error')).toBe(code);
      expect(response.headers.get('X-Request-ID')).toBe(data.requestId);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(log).toHaveBeenCalledExactlyOnceWith('Request failed:', {
        code,
        requestId: data.requestId,
      });
      const exposed = JSON.stringify({
        data,
        headers: [...response.headers],
        logs: log.mock.calls,
      });
      for (const secret of [
        'SELECT',
        'token_hash',
        'private-password',
        'private-token',
        '0'.repeat(64),
      ])
        expect(exposed).not.toContain(secret);
    },
  );

  it('still returns diagnostics when the request context also prevents logging', async () => {
    const failure = new Error(
      `Cannot perform I/O on behalf of a different request; ${confidential}`,
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {
      throw failure;
    });
    const response = await send(
      new Request(`${origin}/api/auth/status`),
      existingDatabase(() => true, failure),
    );
    const data = await response.json<{ error: string; code: string; requestId: string }>();
    expect(response.status).toBe(500);
    expect(data.code).toBe('INIT_DB/CROSS_REQUEST_IO');
    expect(data.requestId).toBeTruthy();
    expect(response.headers.get('X-Request-ID')).toBe(data.requestId);
    expect(response.headers.get('X-RepoTrace-Error')).toBe(data.code);
    expect(JSON.stringify(data)).not.toContain(confidential);
    expect(log).toHaveBeenCalledOnce();
  });

  it('preserves expected AppError status and copy without logging an internal failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = existingDatabase(() => false, new Error('unused'));
    const response = await send(
      new Request(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'private-password' }),
      }),
      db,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: '请求来源无效，请从本站操作。' });
    expect(response.headers.get('X-RepoTrace-Error')).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});
