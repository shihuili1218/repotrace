export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  WEBHOOK_KEYS: KVNamespace;
  SETUP_TOKEN?: string;
}

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers });
