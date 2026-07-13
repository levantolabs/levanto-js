import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LevantoClient,
  YesNo,
  AuthError,
  ValidationError,
  ServiceUnavailableError,
  LevantoAPIError,
  LevantoError,
} from '../src/index';
import {
  installFetchMock,
  jsonResponse,
  makeClient,
  yesnoEnvelope,
  type FetchMock,
} from './_helpers';

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = installFetchMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('error mapping', () => {
  it('400 -> ValidationError with detail', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'options must be >= 2' }, 400));
    const err = await makeClient().decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(LevantoError);
    expect(err.status).toBe(400);
    expect(err.detail).toBe('options must be >= 2');
  });

  it('422 -> ValidationError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'unprocessable' }, 422));
    const err = await makeClient().decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.status).toBe(422);
  });

  it('401 -> AuthError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'invalid api key' }, 401));
    const err = await makeClient().decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(401);
    expect(err.detail).toBe('invalid api key');
  });

  it('402 -> AuthError (balance too low)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'balance too low' }, 402));
    const err = await makeClient().decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(402);
  });

  it('503 (no retries) -> ServiceUnavailableError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'model loading' }, 503));
    const err = await makeClient({ maxRetries: 0 }).decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err.status).toBe(503);
    expect(err.detail).toBe('model loading');
  });

  it('other non-2xx -> LevantoAPIError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'teapot' }, 418));
    const err = await makeClient().decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(LevantoAPIError);
    expect(err.status).toBe(418);
  });

  it('handles a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(new Response('gateway timeout', { status: 400 }));
    const err = await makeClient().decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.detail).toBe('gateway timeout');
  });
});

describe('retry / backoff', () => {
  it('retries on 503 then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'loading' }, 503))
      .mockResolvedValueOnce(jsonResponse(yesnoEnvelope, 200));

    const client = makeClient({ maxRetries: 3 });
    const promise = client.decide('doc', new YesNo('q'));
    await vi.runAllTimersAsync();
    const env = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(env.result.answer).toBe('yes');
  });

  it('retries 429 then 500 then succeeds within maxRetries', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse({ detail: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse(yesnoEnvelope, 200));

    const promise = makeClient({ maxRetries: 3 }).decide('doc', new YesNo('q'));
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and throws the mapped error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'still loading' }, 503));

    const promise = makeClient({ maxRetries: 2 })
      .decide('doc', new YesNo('q'))
      .catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(err).toBeInstanceOf(ServiceUnavailableError);
  });
});

describe('ready()', () => {
  it('true on 200', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    expect(await makeClient().ready()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sage.levanto.ai/ready');
  });

  it('false on 503', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    expect(await makeClient().ready()).toBe(false);
  });

  it('does not send an Authorization header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await makeClient().ready();
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('false when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await makeClient().ready()).toBe(false);
  });
});

describe('constructor', () => {
  it('throws a LevantoError without an apiKey', () => {
    expect(() => new LevantoClient({} as unknown as { apiKey: string })).toThrow(LevantoError);
  });
});
