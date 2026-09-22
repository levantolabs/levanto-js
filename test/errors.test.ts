/** Errors, retries, timeouts, readiness, and client setup. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import pkg from '../package.json';
import {
  AllowanceExhaustedError,
  AuthError,
  LevantoAPIError,
  LevantoClient,
  LevantoError,
  ServiceUnavailableError,
  ValidationError,
  VERSION,
  YesNo,
} from '../src';
import { backoffMs } from '../src/http';
import { Recorder, client } from './helpers';
import * as samples from './samples';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Run with fake timers so retry backoff is instant. */
async function run<T>(promise: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const p = promise();
  p.catch(() => undefined);
  await vi.runAllTimersAsync();
  return p;
}

describe('status -> error', () => {
  it.each([
    [400, 'scale levels must be integers in 0..4', ValidationError],
    [401, 'API key required. Provide a valid Levanto API key.', AuthError],
    [402, 'Decision allowance exhausted for this period.', AllowanceExhaustedError],
    [422, 'content: Field required', ValidationError],
    [503, 'Service is still loading.', ServiceUnavailableError],
    [500, 'boom', LevantoAPIError],
    [404, 'Not Found', LevantoAPIError],
  ] as const)('%i', async (status, detail, Cls) => {
    const err = await client(new Recorder([status, { detail }])).decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(Cls);
    expect(err).toMatchObject({ status, detail, name: Cls.name });
    expect(err.message).toContain(detail);
  });

  it('hierarchy', () => {
    expect(new AllowanceExhaustedError('x')).toBeInstanceOf(AuthError);
    for (const Cls of [AuthError, ValidationError, ServiceUnavailableError, LevantoAPIError]) {
      expect(new Cls('x')).toBeInstanceOf(LevantoError);
      expect(new Cls('x')).toBeInstanceOf(Error);
    }
  });

  it('a non-JSON error body becomes the detail', async () => {
    const err = await client(new Recorder([502, 'Bad Gateway'])).decide('doc', new YesNo('q')).catch((e) => e);
    expect(err).toBeInstanceOf(LevantoAPIError);
    expect(err.detail).toBe('Bad Gateway');
  });
});

describe('retries', () => {
  it.each([429, 500, 502, 503, 504])('retries %i, then succeeds', async (status) => {
    const rec = new Recorder([status, { detail: 'x' }], [status, { detail: 'x' }], [200, samples.YESNO]);
    const env = await run(() => client(rec, { maxRetries: 3 }).decide('doc', new YesNo('q')));
    expect(env).toEqual(samples.YESNO);
    expect(rec.requests).toHaveLength(3);
  });

  it('stops at maxRetries', async () => {
    const rec = new Recorder([503, { detail: 'loading' }]);
    const err = await run(() => client(rec, { maxRetries: 2 }).decide('doc', new YesNo('q'))).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(rec.requests).toHaveLength(3);
  });

  it.each([400, 401, 402, 422])('does not retry %i', async (status) => {
    const rec = new Recorder([status, { detail: 'no' }]);
    await run(() => client(rec, { maxRetries: 3 }).decide('doc', new YesNo('q'))).catch(() => undefined);
    expect(rec.requests).toHaveLength(1);
  });

  it('honours Retry-After, capped at 30 s', () => {
    const res = (value: string) => new Response('', { status: 429, headers: { 'retry-after': value } });
    expect(backoffMs(0, res('2'))).toBe(2000);
    expect(backoffMs(0, res('600'))).toBe(30_000);
    expect(backoffMs(5, res('soon'))).toBeLessThanOrEqual(8000);
    for (let a = 0; a < 10; a++) expect(backoffMs(a)).toBeLessThanOrEqual(8000);
  });

  it('retries network errors, then wraps them', async () => {
    const rec = new Recorder(new TypeError('fetch failed'));
    const err = await run(() => client(rec, { maxRetries: 2 }).decide('doc', new YesNo('q'))).catch((e) => e);
    expect(err).toBeInstanceOf(LevantoError);
    expect(err.message).toMatch(/failed: fetch failed/);
    expect(err.status).toBeUndefined();
    expect(rec.requests).toHaveLength(3);
  });

  it('does not retry a timeout', async () => {
    let calls = 0;
    const hang = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        calls++;
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const c = new LevantoClient({ apiKey: 'k', timeout: 50, maxRetries: 3, fetch: hang });
    const err = await run(() => c.decide('doc', new YesNo('q'))).catch((e) => e);
    expect(err.message).toMatch(/timed out after 50 ms/);
    expect(calls).toBe(1);
  });
});

describe('ready', () => {
  it.each([
    [[200, {}] as const, true],
    [[503, { detail: 'loading' }] as const, false],
  ])('%j -> %s', async (reply, expected) => {
    const rec = new Recorder([...reply] as [number, unknown]);
    expect(await client(rec, { maxRetries: 3 }).ready()).toBe(expected);
    expect(rec.requests).toHaveLength(1);
    expect(rec.requests[0].url).toBe('https://sage.levanto.ai/ready');
  });

  it('a network error is false', async () => {
    expect(await client(new Recorder(new TypeError('down'))).ready()).toBe(false);
  });
});

describe('client setup', () => {
  it('reads LEVANTO_API_KEY', async () => {
    vi.stubEnv('LEVANTO_API_KEY', 'lv_env');
    const rec = new Recorder([200, samples.YESNO]);
    await new LevantoClient({ fetch: rec.fetch }).decide('doc', new YesNo('q'));
    expect(rec.headers.Authorization).toBe('Bearer lv_env');
  });

  it('requires a key', () => {
    vi.stubEnv('LEVANTO_API_KEY', '');
    expect(() => new LevantoClient()).toThrow(/API key/);
  });

  it('strips trailing slashes from baseUrl', async () => {
    const rec = new Recorder([200, samples.YESNO]);
    await client(rec, { baseUrl: 'https://example.test//' }).decide('doc', new YesNo('q'));
    expect(rec.requests[0].url).toBe('https://example.test/decide');
  });

  it('VERSION matches package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
