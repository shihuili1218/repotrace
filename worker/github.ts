import { AppError, nowSeconds } from './types';

export interface GitHubRepo {
  id: number;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
}
export interface Stargazer {
  id: number;
  login: string;
  starred_at: string | null;
}
export interface StarPage {
  users: Stargazer[];
  hasNext: boolean;
}
export interface StarProvider {
  repository(name: string): Promise<GitHubRepo>;
  stargazers(name: string, page: number): Promise<StarPage>;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public retryAt = 0,
    public transient = false,
  ) {
    super(message);
  }
}

export function validateGitHubToken(input: unknown): string {
  if (typeof input !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(input.trim()))
    throw new AppError(400, '请填写此项目的 GitHub Token。');
  return input.trim();
}

export function parseRepository(input: unknown) {
  if (typeof input !== 'string')
    throw new AppError(400, '请输入 owner/repository 或 GitHub 仓库地址。');
  const name = input
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  if (
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(name) ||
    /\/(\.|\.\.)$/.test(name)
  ) {
    throw new AppError(400, '仓库格式应为 owner/repository，例如 shihuili1218/repotrace。');
  }
  return name;
}

export function github(input: string): StarProvider {
  async function get(path: string, stars = false) {
    const token = validateGitHubToken(input);
    const headers: Record<string, string> = {
      Accept: stars ? 'application/vnd.github.star+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'RepoTrace/1.0 (personal repository monitor)',
      Authorization: `Bearer ${token}`,
    };
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new GitHubError('GitHub 暂时无法连接，将自动重试。', 0, true);
    }
    if (!response.ok) {
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('X-RateLimit-Remaining') === '0' ||
            response.headers.has('Retry-After')))
      ) {
        const retryAt = Math.max(
          nowSeconds() + 60,
          Number(response.headers.get('X-RateLimit-Reset')) || 0,
          nowSeconds() + (Number(response.headers.get('Retry-After')) || 60),
        );
        throw new GitHubError('GitHub API 暂时限流，等待恢复后自动继续采集。', retryAt, true);
      }
      if (response.status === 401)
        throw new GitHubError('此项目的 GitHub Token 无效或已过期，请在监控项目中更新 Token。');
      if (response.status === 404)
        throw new GitHubError(
          '仓库不存在或此项目的 Token 无权访问。请检查仓库名称，以及 Token 的 Resource owner 和 Repository access。',
        );
      if (response.status === 403) {
        const body = await response
          .json<{ message?: string }>()
          .catch(() => ({}) as { message?: string });
        if (/secondary rate limit|abuse detection/i.test(body.message ?? ''))
          throw new GitHubError('GitHub 暂时限制请求，稍后自动重试。', nowSeconds() + 300, true);
        throw new GitHubError(
          'GitHub 拒绝此项目 Token 的访问（403）。请检查组织访问策略及仓库读取权限，并更新项目 Token。',
        );
      }
      throw new GitHubError(
        `GitHub 请求失败（HTTP ${response.status}）。`,
        0,
        response.status >= 500,
      );
    }
    return response;
  }
  return {
    async repository(name) {
      const response = await get(`/repos/${name}`);
      const repo = await response.json<GitHubRepo>();
      if (
        !Number.isSafeInteger(repo.id) ||
        !Number.isSafeInteger(repo.stargazers_count) ||
        !repo.full_name
      )
        throw new GitHubError('GitHub 仓库数据格式异常。');
      return repo;
    },
    async stargazers(name, page) {
      const response = await get(`/repos/${name}/stargazers?per_page=100&page=${page}`, true);
      const data =
        await response.json<{ starred_at: string; user: { id: number; login: string } }[]>();
      if (
        !Array.isArray(data) ||
        data.some(
          (entry) =>
            !entry.user ||
            !Number.isSafeInteger(entry.user.id) ||
            !/^[a-zA-Z0-9-]+(?:\[bot\])?$/.test(entry.user.login),
        )
      ) {
        throw new GitHubError('GitHub Star 数据格式异常，未发布此快照。');
      }
      return {
        users: data.map((entry) => ({
          id: entry.user.id,
          login: entry.user.login,
          starred_at: entry.starred_at ?? null,
        })),
        hasNext: /<[^>]+>; rel="next"/.test(response.headers.get('Link') ?? ''),
      };
    },
  };
}
