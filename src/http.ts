import { LevantoError, errorForStatus } from './errors';

/** A `fetch`-compatible function. Defaults to the global `fetch`. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  userAgent: string;
  /** Override the transport (mainly for tests / custom environments). */
  fetchImpl?: FetchLike;
}

/** Statuses that warrant a retry (endpoint is scale-to-zero). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full-ish jitter (half fixed, half random). */
function backoffMs(attempt: number): number {
  const capped = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return capped * (0.5 + Math.random() * 0.5);
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

/** Pull the server `detail` string out of an error response body. */
async function extractDetail(response: Response): Promise<string> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return '';
  }
  if (!text) return '';
  try {
    const data = JSON.parse(text) as unknown;
    if (data && typeof data === 'object' && 'detail' in data) {
      const detail = (data as { detail: unknown }).detail;
      return typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
    if (typeof data === 'string') return data;
  } catch {
    // Body was not JSON; fall through to the raw text.
  }
  return text;
}

/**
 * Thin HTTP layer: auth header, JSON encode/decode, per-attempt timeout via
 * `AbortController`, retry with exponential backoff + jitter, and status ->
 * typed-error mapping.
 */
export class Http {
  constructor(private readonly config: HttpConfig) {}

  private get fetchImpl(): FetchLike {
    // Resolve the global lazily so that tests which reassign `global.fetch`
    // after the client is constructed are still picked up.
    return this.config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** Perform an authenticated JSON request with retries. */
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'User-Agent': this.config.userAgent,
      Accept: 'application/json',
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      let response: Response;
      try {
        response = await this.fetchOnce(url, { method, headers, body: payload });
      } catch (err) {
        if (isAbortError(err)) {
          throw new LevantoError(
            `Request to ${path} timed out after ${this.config.timeout}ms`
          );
        }
        lastError = err;
        if (attempt < this.config.maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new LevantoError(`Request to ${path} failed: ${errMessage(err)}`);
      }

      if (response.ok) {
        return parseJson<T>(response);
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < this.config.maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      const detail = await extractDetail(response);
      throw errorForStatus(response.status, detail);
    }

    // Unreachable in practice (loop either returns or throws), but keeps the
    // type checker satisfied and gives a sane message if it ever happens.
    throw new LevantoError(`Request to ${path} failed: ${errMessage(lastError)}`);
  }

  /** `GET /ready`: 200 -> true, anything else -> false. No key required. */
  async ready(): Promise<boolean> {
    const url = `${this.config.baseUrl}/ready`;
    try {
      const response = await this.fetchOnce(url, {
        method: 'GET',
        headers: { 'User-Agent': this.config.userAgent, Accept: 'application/json' },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private async fetchOnce(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
