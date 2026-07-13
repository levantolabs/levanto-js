import { vi } from 'vitest';
import { LevantoClient, type LevantoClientOptions } from '../src/index';

/** A vi mock stand-in for the global fetch. */
export type FetchMock = ReturnType<typeof vi.fn>;

/** Install a fresh mock as `global.fetch` and return it. */
export function installFetchMock(): FetchMock {
  const mock = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mock;
  return mock;
}

/** Build a JSON Response like the API returns. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A client pointed at the default base URL with retries off (unless overridden). */
export function makeClient(opts: Partial<LevantoClientOptions> = {}): LevantoClient {
  return new LevantoClient({ apiKey: 'test-key', maxRetries: 0, ...opts });
}

/** Parse the JSON body of the Nth recorded fetch call. */
export function requestBody(mock: FetchMock, call = 0): any {
  const init = mock.mock.calls[call][1];
  return JSON.parse(init.body as string);
}

/** URL of the Nth recorded fetch call. */
export function requestUrl(mock: FetchMock, call = 0): string {
  return mock.mock.calls[call][0] as string;
}

/** Request init of the Nth recorded fetch call. */
export function requestInit(mock: FetchMock, call = 0): RequestInit {
  return mock.mock.calls[call][1] as RequestInit;
}

// Sample response payloads -------------------------------------------------

export const yesnoEnvelope = {
  id: 'yesno',
  kind: 'yesno',
  result: { probability: 0.82, confidence: 0.91, answer: 'yes' },
  meta: { model: 'sage-0.5', latency_ms: 12 },
};

export const choiceEnvelope = {
  id: 'choice',
  kind: 'choice',
  result: {
    chosen: 'approve',
    confidence: 0.77,
    probabilities: [
      { option: 'approve', probability: 0.77 },
      { option: 'revise', probability: 0.23 },
    ],
  },
  meta: { model: 'sage-0.5', latency_ms: 20 },
};

export const scaleEnvelope = {
  id: 'scale',
  kind: 'scale',
  result: { expectation: 2.8, confidence: 0.6 },
  meta: { model: 'sage-0.5', latency_ms: 15 },
};

export const sortEnvelope = {
  id: 'sort',
  kind: 'sort',
  result: { sorted: ['b', 'a', 'c'], confidence: 0.4 },
  meta: { model: 'sage-0.5', latency_ms: 30 },
};

export const tagsEnvelope = {
  id: 'tags',
  kind: 'tags',
  result: {
    tags: [
      { id: 'urgent', probability: 0.9, confidence: 0.8, applies: true },
      { id: 'spam', probability: 0.1, confidence: 0.7 },
    ],
  },
  meta: { model: 'sage-0.5', latency_ms: 18 },
};
