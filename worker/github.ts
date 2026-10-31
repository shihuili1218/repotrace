import { AppError } from './types';
import { githubFailure, GitHubError } from './github-errors';
export { GitHubError } from './github-errors';

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
    if (!response.ok)
      throw await githubFailure(response, token, stars ? 'stargazers' : 'repository');
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
