import { AppError } from './types';

export function parseRepository(input: unknown): string {
  if (typeof input !== 'string') throw new AppError(400, '请填写 owner/repo 或 GitHub 仓库地址。');
  const name = input
    .trim()
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  if (
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(name) ||
    /\/(\.|\.\.)$/.test(name)
  )
    throw new AppError(400, '仓库格式应为 owner/repo 或 https://github.com/owner/repo。');
  return name;
}
