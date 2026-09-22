/** What the SDK returns: envelopes as sent, batch answers flattened and aligned. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  Choice,
  Scale,
  Sort,
  Tags,
  YesNo,
  type BatchItem,
  type ChoiceResult,
  type DecideEnvelope,
  type SortResult,
  type TagsResult,
  type YesNoResult,
} from '../src';
import { Recorder, client, expectValidResponse } from './helpers';
import * as samples from './samples';

const LEVELS = ['none', 'low', 'medium', 'high', 'severe'];

describe('samples match the spec', () => {
  it.each(Object.entries(samples.SINGLES))('%s', (schema, bodies) => {
    for (const body of bodies) expectValidResponse(body, schema);
  });
  it('batch', () => expectValidResponse(samples.batch([samples.YESNO, 'bad question'], [samples.SORT]), 'BatchDecideResponsePublic'));
});

describe('responses', () => {
  it.each(Object.values(samples.SINGLES).flat().map((b) => [(b as { id: string }).id, b] as const))(
    'decide returns the envelope unchanged (%s)',
    async (_, body) => {
      expect(await client(new Recorder([200, body])).decide('doc', new YesNo('q'))).toEqual(body);
    }
  );

  it('null answers come through', async () => {
    expect(await client(new Recorder([200, samples.YESNO_UNSURE])).yesno('doc', 'q')).toEqual({ answer: null, probability: 0.51 });
    const ch = await client(new Recorder([200, samples.CHOICE_UNSURE])).choice('doc', 'q', ['approve', 'revise']);
    expect([ch.chosen, ch.probability, ch.probabilities.length]).toEqual([null, null, 2]);
    const tg = await client(new Recorder([200, samples.TAGS])).tags('doc', ['summary', 'outline', 'quiz']);
    expect(tg.tags.map((t) => t.applies)).toEqual([true, false, null]);
    const so = await client(new Recorder([200, samples.SORT_NO_CONFIDENCE])).sort([{ id: 'a', content: 'x' }], 'q');
    expect(so.confidence).toBeNull();
  });

  it('reasoning and usage meta come through', async () => {
    const env = await client(new Recorder([200, samples.YESNO_REASONED])).decide('doc', new YesNo('q'), { reasoning: 'on' });
    expect(env.meta.reasoning).toEqual(samples.REASONING_META);
    const img = await client(new Recorder([200, samples.IMAGE_YESNO])).decide('doc', new YesNo('q'));
    expect(img.meta.usage?.image_count).toBe(1);
  });

  it('batch items read like single decides', async () => {
    const rec = new Recorder([200, samples.batch([samples.YESNO_REASONED, samples.SCALE, samples.GROUNDED])]);
    const items = await client(rec).decide('doc', [new YesNo('a'), new Scale('b', LEVELS, { id: 'sev' }), new YesNo('c')]);
    expect(items.map((i) => [i.id, i.kind, i.ok])).toEqual([
      ['q0', 'yesno', true],
      ['sev', 'scale', true],
      ['q2', 'yesno', true],
    ]);
    expect(items[0].result).toEqual(samples.YESNO_REASONED.result);
    expect(items[0].meta?.reasoning?.tokens).toBe(312);
    expect(items[1]).not.toHaveProperty('grounding_meta');
    expect(items[2].grounding_meta?.triggered).toBe(true);
  });

  it('a failed batch answer is isolated', async () => {
    const rec = new Recorder([200, samples.batch([samples.YESNO, 'sort needs list content'])]);
    const items = await client(rec).decide('doc', [new YesNo('a'), new Sort('b')]);
    expect(items[0].ok).toBe(true);
    expect(items[1]).toEqual({ id: 'q1', kind: 'sort', ok: false, error: 'sort needs list content' });
  });

  it('a missing batch answer is reported, not dropped', async () => {
    const items = await client(new Recorder([200, samples.batch([samples.YESNO])])).decide('doc', [new YesNo('a'), new YesNo('b')]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ ok: false, error: expect.stringContaining('missing') });
  });

  it('groups align to input', async () => {
    const rec = new Recorder([200, samples.batch([samples.YESNO], [samples.CHOICE, samples.TAGS])]);
    const out = await client(rec).decideGroups([
      { document: 'doc a', questions: [new YesNo('a')] },
      { document: 'doc b', questions: [new Choice('b', ['x', 'y']), new Tags(['t'], { id: 'tg' })] },
    ]);
    expect(out.map((g) => g.items.map((i) => [i.id, i.kind]))).toEqual([[['q0', 'yesno']], [['q0', 'choice'], ['tg', 'tags']]]);
    expect(out[1].items[1].result).toEqual(samples.TAGS.result);
  });
});

describe('types', () => {
  it('decide narrows the result type by question kind', () => {
    const c = client(new Recorder());
    expectTypeOf(c.decide('d', new YesNo('q'))).resolves.toEqualTypeOf<DecideEnvelope<'yesno'>>();
    expectTypeOf<DecideEnvelope<'yesno'>['result']>().toEqualTypeOf<YesNoResult>();
    expectTypeOf(c.decide('d', [new YesNo('q')])).resolves.toEqualTypeOf<BatchItem[]>();
    expectTypeOf(c.choice('d', 'q', ['a'])).resolves.toEqualTypeOf<ChoiceResult>();
    expectTypeOf(c.sort([], 'q')).resolves.toEqualTypeOf<SortResult>();
    expectTypeOf(c.tags('d', ['a'])).resolves.toEqualTypeOf<TagsResult>();
  });

  it('nullable fields are nullable', () => {
    expectTypeOf<YesNoResult['answer']>().toEqualTypeOf<'yes' | 'no' | null>();
    expectTypeOf<ChoiceResult['chosen']>().toEqualTypeOf<string | null>();
    expectTypeOf<ChoiceResult['probability']>().toEqualTypeOf<number | null>();
    expectTypeOf<TagsResult['tags'][number]['applies']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<YesNoResult>().not.toHaveProperty('confidence');
  });
});
