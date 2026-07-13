import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Choice, Scale, Sort, Tags, YesNo } from '../src/index';
import {
  installFetchMock,
  jsonResponse,
  makeClient,
  yesnoEnvelope,
  choiceEnvelope,
  scaleEnvelope,
  sortEnvelope,
  tagsEnvelope,
  type FetchMock,
} from './_helpers';

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = installFetchMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decide returns the full envelope', () => {
  it('yesno', async () => {
    fetchMock.mockResolvedValue(jsonResponse(yesnoEnvelope));
    const env = await makeClient().decide('doc', new YesNo('q'));
    expect(env.id).toBe('yesno');
    expect(env.kind).toBe('yesno');
    expect(env.meta).toEqual({ model: 'sage-0.5', latency_ms: 12 });
    expect(env.result).toEqual({ probability: 0.82, confidence: 0.91, answer: 'yes' });
  });

  it('choice', async () => {
    fetchMock.mockResolvedValue(jsonResponse(choiceEnvelope));
    const env = await makeClient().decide('doc', new Choice('pick', ['approve', 'revise']));
    expect(env.result.chosen).toBe('approve');
    expect(env.result.probabilities).toHaveLength(2);
  });

  it('scale', async () => {
    fetchMock.mockResolvedValue(jsonResponse(scaleEnvelope));
    const env = await makeClient().decide('doc', new Scale('rate', ['a', 'b', 'c', 'd', 'e']));
    expect(env.result).toEqual({ expectation: 2.8, confidence: 0.6 });
  });
});

describe('shortcuts return just the result payload', () => {
  it('yesno', async () => {
    fetchMock.mockResolvedValue(jsonResponse(yesnoEnvelope));
    const r = await makeClient().yesno('doc', 'q');
    expect(r).toEqual({ probability: 0.82, confidence: 0.91, answer: 'yes' });
  });

  it('choice', async () => {
    fetchMock.mockResolvedValue(jsonResponse(choiceEnvelope));
    const r = await makeClient().choice('doc', 'pick', ['approve', 'revise']);
    expect(r.chosen).toBe('approve');
  });

  it('scale', async () => {
    fetchMock.mockResolvedValue(jsonResponse(scaleEnvelope));
    const r = await makeClient().scale('doc', 'rate', ['a', 'b', 'c', 'd', 'e']);
    expect(r.expectation).toBe(2.8);
  });

  it('tags with applies flag', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tagsEnvelope));
    const r = await makeClient().tags('doc', [{ id: 'urgent', threshold: 0.5 }, 'spam']);
    expect(r.tags[0]).toEqual({ id: 'urgent', probability: 0.9, confidence: 0.8, applies: true });
    expect(r.tags[1].applies).toBeUndefined();
  });
});

describe('sort confidence is nullable', () => {
  it('parses a numeric confidence', async () => {
    fetchMock.mockResolvedValue(jsonResponse(sortEnvelope));
    const r = await makeClient().sort(
      [{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }, { id: 'c', content: 'c' }],
      'order'
    );
    expect(r.sorted).toEqual(['b', 'a', 'c']);
    expect(r.confidence).toBe(0.4);
  });

  it('parses a null confidence (long lists)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'sort',
        kind: 'sort',
        result: { sorted: ['a', 'b'], confidence: null },
        meta: { model: 'm', latency_ms: 5 },
      })
    );
    const r = await makeClient().sort(
      [{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }],
      'order'
    );
    expect(r.confidence).toBeNull();
  });
});

describe('grounding_meta passthrough', () => {
  it('surfaces grounding_meta on the envelope', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...yesnoEnvelope,
        grounding_meta: {
          triggered: true,
          queries: ['who is the ceo'],
          sources: [{ url: 'https://example.com', title: 'X' }],
        },
      })
    );
    const env = await makeClient().decide('doc', new YesNo('q', { grounding: {} }));
    expect(env.grounding_meta?.triggered).toBe(true);
    expect(env.grounding_meta?.queries).toEqual(['who is the ceo']);
    expect(env.grounding_meta?.sources).toHaveLength(1);
  });

  it('absent when grounding did not run', async () => {
    fetchMock.mockResolvedValue(jsonResponse(yesnoEnvelope));
    const env = await makeClient().decide('doc', new YesNo('q'));
    expect(env.grounding_meta).toBeUndefined();
  });
});

describe('batch response parsing', () => {
  it('flattens the nested envelope so items read like single decides', async () => {
    // The batch groups results per document: results[0].answers[] holds one
    // answer per question, each nesting a full single-decide envelope.
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            answers: [
              {
                ok: true,
                result: {
                  id: 'q0',
                  kind: 'yesno',
                  result: { probability: 0.5, confidence: 0.5, answer: 'no' },
                  meta: { model: 'sage-0.5', latency_ms: 11 },
                },
              },
              {
                ok: true,
                result: {
                  id: 'mytags',
                  kind: 'tags',
                  result: { tags: [{ id: 't', probability: 0.2, confidence: 0.3 }] },
                  meta: { model: 'sage-0.5', latency_ms: 14 },
                  grounding_meta: { triggered: true, queries: ['t?'] },
                },
              },
              { ok: false, error: 'rendered request too large' },
            ],
          },
        ],
        meta: { request_count: 1, question_count: 3 },
      })
    );
    const items = await makeClient().decide('doc', [
      new YesNo('q'),
      new Tags(['t'], { id: 'mytags' }),
      new Sort('order'),
    ]);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['q0', 'mytags', 'q2']);
    expect(items.map((i) => i.kind)).toEqual(['yesno', 'tags', 'sort']);
    // ok item: result is the bare payload (not the envelope), plus meta.
    expect(items[0].ok).toBe(true);
    expect(items[0].result).toEqual({ probability: 0.5, confidence: 0.5, answer: 'no' });
    expect(items[0].meta).toEqual({ model: 'sage-0.5', latency_ms: 11 });
    expect(items[0].grounding_meta).toBeUndefined();
    // grounding_meta is surfaced when the nested envelope carried it.
    expect(items[1].grounding_meta?.triggered).toBe(true);
    // error item: no result/meta, error is set.
    expect(items[2].ok).toBe(false);
    expect(items[2].error).toBe('rendered request too large');
    expect(items[2].result).toBeUndefined();
    expect(items[2].meta).toBeUndefined();
  });
});
