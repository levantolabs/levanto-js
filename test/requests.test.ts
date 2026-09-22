/** What the SDK sends: every body is checked against the v1.1 spec (closed-world). */
import { describe, expect, it } from 'vitest';
import { Choice, Scale, Sort, Tags, YesNo, image, imageFromBytes, type Question } from '../src';
import { batchBody, singleBody } from '../src/client';
import { Recorder, client, expectValidRequest, requestErrors } from './helpers';
import * as samples from './samples';

const LEVELS = ['none', 'low', 'medium', 'high', 'severe'];
const ITEMS = [
  { id: 'a', content: 'first' },
  { id: 'b', content: 'second' },
];

const QUESTIONS: Question[] = [
  new YesNo('Needs review?'),
  new YesNo('Needs review?', { id: 'needs_review', grounding: { trigger: 'always' } }),
  new Choice('Route?', ['billing', 'support']),
  new Choice('Route?', [{ option: 'billing', description: 'Invoices' }, 'support']),
  new Scale('How urgent?', LEVELS),
  new Scale('How urgent?', [0, 1, 2, 3, 4].map((level) => ({ level: level as 0 | 1 | 2 | 3 | 4 }))),
  new Tags(['spam', { id: 'scam', name: 'scam: fraud or phishing' }]),
  new Tags(['spam'], { instructions: 'Tag only what the post is.', grounding: { confidenceFloor: 0.9 } }),
];

describe('bodies match the spec', () => {
  for (const reasoning of [undefined, 'auto', 'off', 'on'] as const) {
    it.each(QUESTIONS.map((q) => [q.kind, q] as const))(`single %s (reasoning=${reasoning})`, (_, q) => {
      expectValidRequest(singleBody('some text', q, reasoning), 'DecideRequestPublic');
    });
  }

  it('sort', () => expectValidRequest(singleBody(ITEMS, new Sort('Most urgent first'), 'off'), 'DecideRequestPublic'));

  it('batch with several groups', () => {
    const body = batchBody(
      [
        { document: 'text', questions: QUESTIONS },
        { document: ITEMS, questions: [new Sort('Rank')] },
      ],
      'on'
    );
    expectValidRequest(body, 'BatchDecideRequestPublic');
  });

  it('image, single and batch', () => {
    const img = imageFromBytes(samples.PNG_BLUE, { text: 'Ticket: button missing' });
    expectValidRequest(singleBody(img, new YesNo('Shows the bug?')), 'DecideRequestPublic');
    expectValidRequest(
      batchBody([{ document: img, questions: [new YesNo('Bug?'), new Tags(['ui', 'crash'])] }]),
      'BatchDecideRequestPublic'
    );
  });

  it.each([
    [{ content: 'x', question: { id: 'a', kind: 'yesno', instructions: 'q', confidence: 1 } }],
    [{ content: 'x', question: { id: 'a', kind: 'scale', instructions: 'q', levels: [{ level: 0 }, { level: 1 }] } }],
    [{ content: 'x', question: { id: 'a', kind: 'yesno', instructions: 'q' }, reasoning: 'maybe' }],
    [{ content: { kind: 'image', url: 'https://x/y.png' }, question: { id: 'a', kind: 'yesno', instructions: 'q' } }],
    [{ question: { id: 'a', kind: 'yesno', instructions: 'q' } }],
  ])('the contract check rejects invalid bodies (%#)', (body) => {
    expect(requestErrors(body, 'DecideRequestPublic')).not.toEqual([]);
  });
});

describe('exact wire shapes', () => {
  it('single: grounding top-level in snake_case, id defaults to the kind', () => {
    const q = new YesNo('Needs review?', {
      grounding: { trigger: 'low_confidence', confidenceFloor: 0.85, maxResults: 5, maxContextTokens: 500, returnSources: false },
    });
    expect(singleBody('doc', q)).toEqual({
      content: 'doc',
      question: { id: 'yesno', kind: 'yesno', instructions: 'Needs review?' },
      grounding: { trigger: 'low_confidence', confidence_floor: 0.85, max_results: 5, max_context_tokens: 500, return_sources: false },
    });
    expect(singleBody('d', new Scale('x', LEVELS, { id: 'sev' })).question).toMatchObject({ id: 'sev' });
  });

  it('batch: grounding inside each question, ids q0, q1, …, no latency_mode', () => {
    const body = batchBody([{ document: 'doc', questions: [new YesNo('a?', { grounding: { trigger: 'always' } }), new Scale('b?', LEVELS, { id: 'sev' })] }]);
    expect(body).toEqual({
      requests: [
        {
          content: 'doc',
          questions: [
            { id: 'q0', kind: 'yesno', instructions: 'a?', grounding: { trigger: 'always' } },
            { id: 'sev', kind: 'scale', instructions: 'b?', levels: new Scale('b?', LEVELS).levels },
          ],
        },
      ],
    });
  });

  it('reasoning is sent only when set', () => {
    expect(singleBody('d', new YesNo('q'))).not.toHaveProperty('reasoning');
    expect(singleBody('d', new YesNo('q'), null)).not.toHaveProperty('reasoning');
    expect(singleBody('d', new YesNo('q'), 'off')).toHaveProperty('reasoning', 'off');
    expect(batchBody([{ document: 'd', questions: [new YesNo('q')] }], 'on')).toHaveProperty('reasoning', 'on');
  });

  it('shorthands', () => {
    expect(new Choice('x', ['a', 'b']).options).toEqual([{ option: 'a' }, { option: 'b' }]);
    expect(new Scale('x', LEVELS).levels).toEqual(LEVELS.map((description, level) => ({ level, description })));
    expect(new Tags(['a', { id: 'b', name: 'b: bee' }]).tags).toEqual([{ id: 'a' }, { id: 'b', name: 'b: bee' }]);
  });

  it('tags instructions only when set', () => {
    expect(new Tags(['a']).toWire('t')).not.toHaveProperty('instructions');
    expect(new Tags(['a'], { instructions: 'rule' }).toWire('t')).toHaveProperty('instructions', 'rule');
  });

  it('an empty batch group is rejected before sending', () => {
    expect(() => batchBody([{ document: 'doc', questions: [] }])).toThrow(/at least one question/);
  });

  it('a list of items becomes list content', () => {
    expect(singleBody(ITEMS, new Sort('x')).content).toEqual({ kind: 'list', value: ITEMS });
  });
});

describe('images', () => {
  it('detects PNG, JPEG, WebP and builds a data URI', () => {
    const png = imageFromBytes(samples.PNG_BLUE);
    expect(png).toEqual({ kind: 'image', media: `data:image/png;base64,${Buffer.from(samples.PNG_BLUE).toString('base64')}` });
    expect(imageFromBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])).media).toMatch(/^data:image\/jpeg;base64,/);
    expect(imageFromBytes(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')).media).toMatch(/^data:image\/webp;base64,/);
    expect(imageFromBytes(samples.PNG_BLUE.buffer as ArrayBuffer).media).toBe(png.media);
  });

  it('rejects other formats', () => {
    expect(() => imageFromBytes(new TextEncoder().encode('GIF89a...'))).toThrow(/PNG, JPEG, or WebP/);
    expect(() => imageFromBytes(samples.PNG_BLUE, { mimeType: 'image/gif' as never })).toThrow();
  });

  it('works without Buffer (browsers)', () => {
    const saved = (globalThis as { Buffer?: unknown }).Buffer;
    (globalThis as { Buffer?: unknown }).Buffer = undefined;
    try {
      expect(imageFromBytes(samples.PNG_BLUE).media).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...samples.PNG_BLUE))}`);
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = saved;
    }
  });

  it('image() wraps a data URI you already have', () => {
    expect(image('data:image/png;base64,AAA', 'ctx')).toEqual({ kind: 'image', media: 'data:image/png;base64,AAA', text: 'ctx' });
  });
});

describe('the client sends what the builders build', () => {
  it('POST /decide with auth and user agent', async () => {
    const rec = new Recorder([200, samples.YESNO]);
    await client(rec).decide('doc', new YesNo('Needs review?'));
    expect(rec.requests[0].url).toBe('https://sage.levanto.ai/decide');
    expect(rec.requests[0].init.method).toBe('POST');
    expect(rec.headers.Authorization).toBe('Bearer lv_test_key');
    expect(rec.headers['User-Agent']).toBe('levanto-js/1.1.0');
    expect(rec.body).toEqual(singleBody('doc', new YesNo('Needs review?')));
  });

  it('reasoning: client default, per-call override, null to send none', async () => {
    const rec = new Recorder([200, samples.YESNO]);
    const c = client(rec, { reasoning: 'off' });
    await c.decide('doc', new YesNo('q'));
    expect(rec.body.reasoning).toBe('off');
    await c.decide('doc', new YesNo('q'), { reasoning: 'on' });
    expect(rec.body.reasoning).toBe('on');
    await c.decide('doc', new YesNo('q'), { reasoning: null });
    expect(rec.body).not.toHaveProperty('reasoning');
    await c.yesno('doc', 'q', { reasoning: 'on' });
    expect(rec.body.reasoning).toBe('on');
  });

  it('batch and groups', async () => {
    let rec = new Recorder([200, samples.batch([samples.YESNO, samples.SCALE])]);
    await client(rec).decide('doc', [new YesNo('a'), new Scale('b', LEVELS)], { reasoning: 'off' });
    expect(rec.requests[0].url).toMatch(/\/decide\/batch$/);
    expect(rec.body).toEqual(batchBody([{ document: 'doc', questions: [new YesNo('a'), new Scale('b', LEVELS)] }], 'off'));

    rec = new Recorder([200, samples.batch([samples.YESNO], [samples.SORT])]);
    const groups = [
      { document: 'doc', questions: [new YesNo('a')] },
      { document: ITEMS, questions: [new Sort('rank')] },
    ];
    await client(rec).decideGroups(groups);
    expect(rec.body).toEqual(batchBody(groups));
    expectValidRequest(rec.body, 'BatchDecideRequestPublic');
  });

  it.each([
    ['yesno', (c: ReturnType<typeof client>) => c.yesno('doc', 'q', { id: 'x' }), singleBody('doc', new YesNo('q', { id: 'x' }))],
    ['choice', (c: ReturnType<typeof client>) => c.choice('doc', 'q', ['a', 'b']), singleBody('doc', new Choice('q', ['a', 'b']))],
    [
      'scale',
      (c: ReturnType<typeof client>) => c.scale('doc', 'q', LEVELS, { grounding: { trigger: 'never' } }),
      singleBody('doc', new Scale('q', LEVELS, { grounding: { trigger: 'never' } })),
    ],
    ['sort', (c: ReturnType<typeof client>) => c.sort(ITEMS, 'q'), singleBody(ITEMS, new Sort('q'))],
    ['tags', (c: ReturnType<typeof client>) => c.tags('doc', ['a'], { instructions: 'rule' }), singleBody('doc', new Tags(['a'], { instructions: 'rule' }))],
  ])('shortcut %s sends the matching question', async (_, run, expected) => {
    const rec = new Recorder([200, samples.YESNO]);
    await run(client(rec));
    expect(rec.body).toEqual(expected);
  });
});
