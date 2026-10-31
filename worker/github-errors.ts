import { nowSeconds } from './types';

type Reason =
  | 'rate_limit'
  | 'sso'
  | 'ip_policy'
  | 'organization_policy'
  | 'account'
  | 'permission'
  | 'authentication'
  | 'not_found'
  | 'unknown';
export interface GitHubDiagnostic {
  status: number;
  operation: 'repository' | 'stargazers';
  reason: Reason;
  message: string | null;
  requestId: string | null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public retryAt = 0,
    public transient = false,
    public diagnostic?: GitHubDiagnostic,
  ) {
    super(message);
  }
}

function redact(value: string, token: string) {
  let safe = value;
  for (const secret of [token, encodeURIComponent(token)]) {
    if (secret) safe = safe.replaceAll(secret, '[redacted]');
  }
  return safe
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, '[redacted]')
    .replace(
      /([?&](?:access_token|token|authorization_request|code)=)[^&\s"'<>]+/gi,
      '$1[redacted]',
    )
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

async function errorMessage(response: Response, token: string) {
  // Read only a bounded JSON message. Never forward a full response, HTML, or headers.
  const reader = response.body?.getReader();
  if (!reader) return null;
  const limit = 8192;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > limit) {
        await reader.cancel();
        return null;
      }
      size += value.length;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !body ||
      typeof body !== 'object' ||
      !('message' in body) ||
      typeof body.message !== 'string'
    )
      return null;
    return redact(body.message, token) || null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function githubFailure(
  response: Response,
  token: string,
  operation: GitHubDiagnostic['operation'],
) {
  const message = await errorMessage(response, token);
  const text = message ?? '';
  const status = response.status;
  const candidateId = response.headers.get('X-GitHub-Request-Id') ?? '';
  const requestId =
    /^[a-zA-Z0-9:-]{1,128}$/.test(candidateId) && !candidateId.includes(token) ? candidateId : null;
  let reason: Reason = 'unknown';
  let hint = 'GitHub 拒绝请求，具体原因需要根据下方消息确认。';
  let transient = status >= 500;
  let retryAt = 0;
  if (status === 401) {
    reason = 'authentication';
    hint = '此项目的 Token 无效或已过期，请更新项目 Token。';
  } else if (status === 404) {
    reason = 'not_found';
    hint = '仓库不存在或当前 Token 无权访问，请检查仓库名称及访问范围。';
  } else if ([403, 429].includes(status)) {
    if (
      /^required(?:;|$)/i.test(response.headers.get('X-GitHub-SSO') ?? '') ||
      /SAML|single sign.on|\bSSO\b/i.test(text)
    ) {
      reason = 'sso';
      hint = '组织要求完成 SSO 身份授权，请检查该 Token 的组织身份认证。';
    } else if (
      /\bIP\b.*(?:restrict|allow|permitted)|(?:allow.?list|white.?list).*\bIP\b/i.test(text)
    ) {
      reason = 'ip_policy';
      hint = '组织的 IP 访问策略拒绝了当前部署的出口地址。';
    } else if (
      status === 429 ||
      response.headers.get('X-RateLimit-Remaining') === '0' ||
      response.headers.has('Retry-After') ||
      /rate limit|abuse detection|too many requests/i.test(text)
    ) {
      reason = 'rate_limit';
      hint = 'GitHub 暂时限制请求，稍后会自动重试。';
      transient = true;
      const reset = Number(response.headers.get('X-RateLimit-Reset'));
      const delay = Number(response.headers.get('Retry-After'));
      retryAt = Math.max(
        nowSeconds() + 60,
        Number.isFinite(reset) ? reset : 0,
        nowSeconds() + (Number.isFinite(delay) && delay > 0 ? delay : 60),
      );
    } else if (
      /organization.*(?:policy|restrict|block|disabled|approval)|enterprise.*(?:policy|restrict|block)|personal access tokens?.*(?:not allowed|blocked|disabled)|pending.*approval/i.test(
        text,
      )
    ) {
      reason = 'organization_policy';
      hint = '组织或企业的 Token 访问策略阻止了此次请求。';
    } else if (/email.*(?:verif|validat)|(?:verif|validat).*email/i.test(text)) {
      reason = 'account';
      hint = 'GitHub 要求先完成账号验证。';
    } else if (/resource not accessible|insufficient|permission|access denied/i.test(text)) {
      reason = 'permission';
      hint = 'GitHub 未授予此 Token 对当前接口的访问权限。';
    }
  } else hint = 'GitHub 服务请求失败，请稍后重试。';
  const diagnostic: GitHubDiagnostic = { status, operation, reason, message, requestId };
  const label = operation === 'stargazers' ? '读取 Star 列表' : '读取仓库信息';
  const detail = message && reason !== 'rate_limit' ? ` GitHub message: ${message}` : '';
  const reference = requestId ? ` Request ID: ${requestId}` : '';
  return new GitHubError(
    `${label}失败（HTTP ${status}）。${hint}${detail}${reference}`,
    retryAt,
    transient,
    diagnostic,
  );
}
