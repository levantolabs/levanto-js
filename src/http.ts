import { LevantoError, errorForStatus } from './errors';

/** A `fetch`-compatible function. Defaults to the global `fetch`. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  userAgent: string;
  fetchImpl?: FetchLike;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** @internal Milliseconds before retry `attempt` (0-based): `Retry-After` if sent, else exponential with jitter. */
export function backoffMs(attempt: number, response?: Response): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0), 30) * 1000;
  }
  return Math.random() * Math.min(8000, 500 * 2 ** attempt);
}

async function detailOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === 'object' && 'detail' in data) {
      const detail = (data as { detail: unknown }).detail;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
  } catch {
    // not JSON: use the raw text
  }
  return text;
}

const isAbort = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';

/** @internal Auth, JSON, per-attempt timeout, retries, and status -> error mapping. */
export class Http {
  constructor(private readonly config: HttpConfig) {}

  private fetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    const impl = this.config.fetchImpl ?? ((u, i) => globalThis.fetch(u, i));
    return impl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': this.config.userAgent,
      },
      body: JSON.stringify(body),
    };
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(`${this.config.baseUrl}${path}`, init);
      } catch (err) {
        // A timed-out request may still have been processed (and billed), so it is not retried.
        if (isAbort(err)) throw new LevantoError(`POST ${path} timed out after ${this.config.timeout} ms`);
        if (attempt < this.config.maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new LevantoError(`POST ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (response.ok) return (await response.json()) as T;
      if (RETRYABLE_STATUS.has(response.status) && attempt < this.config.maxRetries) {
        await sleep(backoffMs(attempt, response));
        continue;
      }
      throw errorForStatus(response.status, await detailOf(response));
    }
  }

  /** `GET /ready`: true on 200. Never retried; network errors return false. */
  async ready(): Promise<boolean> {
    try {
      const response = await this.fetch(`${this.config.baseUrl}/ready`, {
        method: 'GET',
        headers: { 'User-Agent': this.config.userAgent },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
