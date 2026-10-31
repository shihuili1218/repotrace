import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubFailure } from '../worker/github-errors';
import { github } from '../worker/github';
import { nowSeconds } from '../worker/types';

afterEach(() => vi.restoreAllMocks());

describe('GitHub rejection diagnostics', () => {
  it.each([
    [
      'ip_policy',
      'Although you appear to have the correct authorization credentials, the organization has enabled IP address restrictions, and your IP address is not permitted to access this resource.',
    ],
    ['organization_policy', 'The organization has disabled access via personal access tokens.'],
    ['account', 'Please verify your email address before using this API.'],
    ['permission', 'Resource not accessible by personal access token'],
  ])(
    'identifies %s without changing token permissions or retrying indefinitely',
    async (reason, message) => {
      const error = await githubFailure(
        Response.json(
          { message },
          {
            status: 403,
            headers: { 'X-GitHub-Request-Id': 'ABCD:1234:0001' },
          },
        ),
        'test-token',
        'stargazers',
      );
      expect(error.diagnostic).toMatchObject({
        status: 403,
        operation: 'stargazers',
        reason,
        message,
        requestId: 'ABCD:1234:0001',
      });
      expect(error.transient).toBe(false);
      expect(error.message).toContain(message);
      expect(error.message).toContain('ABCD:1234:0001');
    },
  );

  it('does not claim an organization policy when the cause is unknown', async () => {
    const error = await githubFailure(
      Response.json({ message: 'Forbidden' }, { status: 403 }),
      'test-token',
      'repository',
    );
    expect(error.diagnostic).toMatchObject({
      operation: 'repository',
      reason: 'unknown',
      message: 'Forbidden',
    });
    expect(error.message).not.toContain('组织');
  });

  it('reports SSO enforcement without exposing its authorization link or response headers', async () => {
    const response = Response.json(
      { message: 'SAML enforcement applies', ignored: 'body-secret' },
      {
        status: 403,
        headers: {
          'X-GitHub-SSO':
            'required; url=https://github.com/orgs/rssh-org/sso?authorization_request=private-sso-code',
          'Set-Cookie': 'private-cookie',
        },
      },
    );
    const error = await githubFailure(response, 'test-token', 'repository');
    expect(error.diagnostic?.reason).toBe('sso');
    for (const secret of ['private-sso-code', 'private-cookie', 'body-secret']) {
      expect(JSON.stringify(error.diagnostic)).not.toContain(secret);
      expect(error.message).not.toContain(secret);
    }
  });

  it.each([
    [
      { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(nowSeconds() + 600) },
      'API rate limit exceeded',
    ],
    [{}, 'You have exceeded a secondary rate limit.'],
  ])(
    'defers temporary restrictions rather than marking them as missing permissions',
    async (headers, message) => {
      const error = await githubFailure(
        Response.json({ message }, { status: 403, headers }),
        'test-token',
        'stargazers',
      );
      expect(error.diagnostic?.reason).toBe('rate_limit');
      expect(error.transient).toBe(true);
      expect(error.retryAt).toBeGreaterThanOrEqual(nowSeconds() + 59);
      expect(error.message).not.toContain('提高额度');
      expect(error.message).not.toContain('更新项目 Token');
    },
  );

  it('redacts current tokens, other GitHub token strings, and authorization URL parameters', async () => {
    const token = 'secret/value?that=must-stay-private';
    const body = {
      message: `Denied ${token} ${encodeURIComponent(token)} ghp_otherSecretToken https://github.com/orgs/example/sso?authorization_request=private-code`,
    };
    const error = await githubFailure(
      Response.json(body, { status: 403 }),
      'secret/value?that=must-stay-private',
      'repository',
    );
    const output = error.message + JSON.stringify(error.diagnostic);
    for (const secret of [token, encodeURIComponent(token), 'ghp_otherSecretToken', 'private-code'])
      expect(output).not.toContain(secret);
    expect(output).toContain('[redacted]');
  });

  it.each(['<html>private HTML</html>', JSON.stringify({ message: 'x'.repeat(10000) })])(
    'handles non-JSON or oversized failures without forwarding their body',
    async (body) => {
      const error = await githubFailure(
        new Response(body, { status: 403 }),
        'test-token',
        'stargazers',
      );
      expect(error.diagnostic?.message).toBeNull();
      expect(error.message.length).toBeLessThan(300);
    },
  );

  it('includes the failing operation and reference when the Star provider throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { message: 'Resource not accessible by personal access token' },
        {
          status: 403,
          headers: { 'X-GitHub-Request-Id': 'EEFF:0001:ABCD' },
        },
      ),
    );
    await expect(github('test-token').stargazers('rssh-org/rssh', 1)).rejects.toMatchObject({
      diagnostic: {
        operation: 'stargazers',
        status: 403,
        message: 'Resource not accessible by personal access token',
        requestId: 'EEFF:0001:ABCD',
      },
    });
  });
});
