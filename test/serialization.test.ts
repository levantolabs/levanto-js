import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Choice, Scale, Tags, YesNo } from '../src/index';
import {
  installFetchMock,
  jsonResponse,
  makeClient,
  requestBody,
  requestUrl,
  requestInit,
  yesnoEnvelope,
  type FetchMock,
} from './_helpers';

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = installFetchMock();
  // Return a fresh Response per call — a Response body can only be read once.
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(yesnoEnvelope)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('content normalization', () => {
  it('sends a bare string as-is', async () => {
    const client = makeClient();
    await client.decide('hello world', new YesNo('spam?'));
    expect(requestBody(fetchMock).content).toBe('hello world');
  });

  it('passes an explicit text object through unchanged', async () => {
    const client = makeClient();
    await client.decide({ kind: 'text', value: 'hi' }, new YesNo('spam?'));
    expect(requestBody(fetchMock).content).toEqual({ kind: 'text', value: 'hi' });
  });

  it('passes an explicit list object through unchanged', async () => {
    const client = makeClient();
    const content = { kind: 'list', value: [{ id: '1', content: 'a' }] };
    await client.decide(content, new YesNo('spam?'));
    expect(requestBody(fetchMock).content).toEqual(content);
  });

  it('wraps a bare array of items as a list', async () => {
    const client = makeClient();
    const items = [{ id: '1', content: 'a' }, { id: '2', content: 'b' }];
    await client.decide(items, new YesNo('spam?'));
    expect(requestBody(fetchMock).content).toEqual({ kind: 'list', value: items });
  });
});

describe('id defaulting', () => {
  it('single call defaults id to the kind string', async () => {
    const client = makeClient();
    await client.decide('doc', new YesNo('q'));
    expect(requestBody(fetchMock).question.id).toBe('yesno');
  });

  it('single call keeps a user-supplied id', async () => {
    const client = makeClient();
    await client.decide('doc', new YesNo('q', { id: 'my-id' }));
    expect(requestBody(fetchMock).question.id).toBe('my-id');
  });

  it('batch defaults ids to q0, q1, ... by index but keeps user ids', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            answers: [
              { ok: true, result: { id: 'q0', kind: 'yesno', result: { probability: 0.5, confidence: 0.5, answer: 'yes' }, meta: {} } },
              { ok: true, result: { id: 'q1', kind: 'choice', result: { chosen: 'a', confidence: 0.5, probabilities: [] }, meta: {} } },
              { ok: true, result: { id: 'mine', kind: 'tags', result: { tags: [] }, meta: {} } },
            ],
          },
        ],
        meta: { request_count: 1, question_count: 3 },
      })
    );
    const client = makeClient();
    await client.decide('doc', [
      new YesNo('q'),
      new Choice('pick', ['a', 'b']),
      new Tags(['x'], { id: 'mine' }),
    ]);
    const body = requestBody(fetchMock);
    // One document + N questions is a single group; ids default within the group.
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].content).toBe('doc');
    expect(body.requests[0].questions.map((q: any) => q.id)).toEqual(['q0', 'q1', 'mine']);
  });
});

describe('request shape and headers', () => {
  it('single call hits POST /decide with auth + UA headers', async () => {
    const client = makeClient();
    await client.decide('doc', new YesNo('q'));
    expect(requestUrl(fetchMock)).toBe('https://sage.levanto.ai/decide');
    const init = requestInit(fetchMock);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['User-Agent']).toMatch(/^levanto-js\//);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('honors a custom baseUrl (trailing slash trimmed)', async () => {
    const client = makeClient({ baseUrl: 'http://localhost:8000/' });
    await client.decide('doc', new YesNo('q'));
    expect(requestUrl(fetchMock)).toBe('http://localhost:8000/decide');
  });

  it('serializes choice options / scale levels / tags onto the question', async () => {
    const client = makeClient();
    await client.decide('doc', new Choice('pick', [{ option: 'a', description: 'd' }]));
    expect(requestBody(fetchMock).question.options).toEqual([{ option: 'a', description: 'd' }]);

    fetchMock.mockClear();
    await client.decide('doc', new Scale('rate', ['x', 'y', 'z', 'p', 'q']));
    expect(requestBody(fetchMock).question.levels).toHaveLength(5);

    fetchMock.mockClear();
    await client.decide('doc', new Tags([{ id: 't', threshold: 0.5 }]));
    const body = requestBody(fetchMock);
    expect(body.question.tags).toEqual([{ id: 't', threshold: 0.5 }]);
    expect(body.question.instructions).toBeUndefined();
  });

  it('emits optional fields: level w/o description, tag name, tags instructions', async () => {
    const client = makeClient();
    // A scale level may omit `description` (server accepts it).
    await client.decide('doc', new Scale('rate', [
      { level: 0 }, { level: 1 }, { level: 2 }, { level: 3 }, { level: 4 },
    ]));
    expect(requestBody(fetchMock).question.levels[0]).toEqual({ level: 0 });

    // A tag may carry an optional human-readable `name`.
    fetchMock.mockClear();
    await client.decide('doc', new Tags([{ id: 'pii', name: 'Personal data', threshold: 0.5 }]));
    expect(requestBody(fetchMock).question.tags).toEqual([
      { id: 'pii', name: 'Personal data', threshold: 0.5 },
    ]);

    // Tags may carry an optional overall instruction.
    fetchMock.mockClear();
    await client.decide('doc', new Tags(['x'], { instructions: 'label strictly' }));
    expect(requestBody(fetchMock).question.instructions).toBe('label strictly');
  });
});

describe('grounding placement', () => {
  it('lifts grounding to the top level and maps confidenceFloor', async () => {
    const client = makeClient();
    await client.decide(
      'doc',
      new YesNo('q', { grounding: { trigger: 'always', confidenceFloor: 0.9 } })
    );
    const body = requestBody(fetchMock);
    expect(body.grounding).toEqual({ trigger: 'always', confidence_floor: 0.9 });
    expect(body.question.grounding).toBeUndefined();
  });

  it('passes extra grounding keys through unchanged', async () => {
    const client = makeClient();
    await client.decide(
      'doc',
      new YesNo('q', { grounding: { confidenceFloor: 0.8, maxSources: 3, allowedDomains: ['x.com'] } })
    );
    expect(requestBody(fetchMock).grounding).toEqual({
      confidence_floor: 0.8,
      maxSources: 3,
      allowedDomains: ['x.com'],
    });
  });

  it('omits grounding entirely when not requested', async () => {
    const client = makeClient();
    await client.decide('doc', new YesNo('q'));
    expect(requestBody(fetchMock)).not.toHaveProperty('grounding');
  });

  it('sort never carries grounding or options', async () => {
    const client = makeClient();
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'sort',
        kind: 'sort',
        result: { sorted: ['a'], confidence: 0.1 },
        meta: { model: 'm', latency_ms: 1 },
      })
    );
    await client.sort([{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }], 'order them');
    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty('grounding');
    expect(body.question).toEqual({ id: 'sort', kind: 'sort', instructions: 'order them' });
  });
});

describe('batch serialization', () => {
  it('sends one group (shared content once) with N questions in order', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            answers: [
              { ok: true, result: { id: 'q0', kind: 'yesno', result: { probability: 0.5, confidence: 0.5, answer: 'yes' }, meta: {} } },
              { ok: true, result: { id: 'q1', kind: 'scale', result: { expectation: 2, confidence: 0.5 }, meta: {} } },
            ],
          },
        ],
        meta: { request_count: 1, question_count: 2 },
      })
    );
    const client = makeClient();
    await client.decide('shared doc', [
      new YesNo('q1'),
      new Scale('q2', ['a', 'b', 'c', 'd', 'e']),
    ]);
    expect(requestUrl(fetchMock)).toBe('https://sage.levanto.ai/decide/batch');
    const body = requestBody(fetchMock);
    // Single group: content sent once, all questions under `questions`.
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].content).toBe('shared doc');
    expect(body.requests[0].questions.map((q: any) => q.kind)).toEqual(['yesno', 'scale']);
  });

  it('embeds grounding inside each batch question (not a top-level sibling)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ answers: [{ ok: true, result: { id: 'q0', kind: 'yesno', result: { probability: 0.5, confidence: 0.5, answer: 'yes' }, meta: {} } }] }], meta: { request_count: 1, question_count: 1 } })
    );
    const client = makeClient();
    await client.decide('doc', [new YesNo('q', { grounding: { trigger: 'always', confidenceFloor: 0.9 } })]);
    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty('grounding');
    expect(body.requests[0].questions[0].grounding).toEqual({ trigger: 'always', confidence_floor: 0.9 });
  });
});

describe('decideGroups (multi-document batch)', () => {
  it('sends one group per document and returns aligned GroupResult[]', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          { answers: [{ ok: true, result: { id: 'q0', kind: 'yesno', result: { probability: 0.9, confidence: 0.8, answer: 'yes' }, meta: { model: 'm', latency_ms: 5 } } }] },
          {
            answers: [
              { ok: true, result: { id: 'q0', kind: 'yesno', result: { probability: 0.1, confidence: 0.8, answer: 'no' }, meta: { model: 'm', latency_ms: 6 } } },
              { ok: false, error: 'boom' },
            ],
          },
        ],
        meta: { request_count: 2, question_count: 3 },
      })
    );
    const client = makeClient();
    const groups = await client.decideGroups([
      { document: 'doc A', questions: [new YesNo('spam?')] },
      { document: 'doc B', questions: [new YesNo('spam?'), new Scale('sev?', ['a', 'b', 'c', 'd', 'e'])] },
    ]);
    // request shape: two groups, content per group, questions nested
    const body = requestBody(fetchMock);
    expect(body.requests.map((r: any) => r.content)).toEqual(['doc A', 'doc B']);
    expect(body.requests.map((r: any) => r.questions.length)).toEqual([1, 2]);
    // response shape: aligned GroupResult[] with flattened items
    expect(groups).toHaveLength(2);
    expect(groups[0].items[0].result).toEqual({ probability: 0.9, confidence: 0.8, answer: 'yes' });
    expect(groups[1].items).toHaveLength(2);
    expect(groups[1].items[0].result).toEqual({ probability: 0.1, confidence: 0.8, answer: 'no' });
    expect(groups[1].items[1].ok).toBe(false);
    expect(groups[1].items[1].error).toBe('boom');
    expect(groups[1].items[1].result).toBeUndefined();
  });
});

describe('bare-string shorthands', () => {
  it('Choice treats each string as { option }', () => {
    const c = new Choice('pick', ['approve', 'revise']);
    expect(c.options).toEqual([{ option: 'approve' }, { option: 'revise' }]);
  });

  it('Scale maps 5 strings to levels 0..4 by index', () => {
    const s = new Scale('rate', ['worst', 'bad', 'ok', 'good', 'best']);
    expect(s.levels).toEqual([
      { level: 0, description: 'worst' },
      { level: 1, description: 'bad' },
      { level: 2, description: 'ok' },
      { level: 3, description: 'good' },
      { level: 4, description: 'best' },
    ]);
  });

  it('Tags treats each string as { id }', () => {
    const t = new Tags(['urgent', 'spam']);
    expect(t.tags).toEqual([{ id: 'urgent' }, { id: 'spam' }]);
  });

  it('explicit object forms still work', () => {
    const c = new Choice('pick', [{ option: 'a', description: 'd' }]);
    expect(c.options).toEqual([{ option: 'a', description: 'd' }]);
    const s = new Scale('rate', [{ level: 0, description: 'lo' }, { level: 4, description: 'hi' }]);
    expect(s.levels).toEqual([{ level: 0, description: 'lo' }, { level: 4, description: 'hi' }]);
  });
});
