/**
 * Live tests against the real Sage API: LEVANTO_API_KEY=lv_live_... npm run test:live
 * Every raw response is validated against the spec. About 15 decisions per run (reasoning is not billed).
 */
import { describe, expect, it } from 'vitest';
import {
  AuthError,
  Choice,
  LevantoClient,
  Scale,
  Sort,
  Tags,
  ValidationError,
  YesNo,
  imageFromBytes,
  type Question,
} from '../src';
import { SPEC, expectValidResponse } from './helpers';
import * as samples from './samples';

const KEY = process.env.LEVANTO_API_KEY;
const BASE_URL = process.env.LEVANTO_BASE_URL ?? 'https://sage.levanto.ai';
const LEVELS = ['no urgency', 'low', 'medium', 'high', 'critical: drop everything'];
const TICKET = 'Checkout returns a 500 for about 10% of EU customers since the deploy 20 minutes ago. Revenue-impacting.';
const INCIDENTS = [
  { id: 'typo', content: 'Spelling mistake on the FAQ page.' },
  { id: 'db_down', content: 'Primary production database is unreachable.' },
  { id: 'pricing', content: 'Prospect asking about Enterprise pricing.' },
];

/** A client whose fetch keeps every raw response body, to validate the wire format. */
function capturing() {
  const bodies: unknown[] = [];
  const client = new LevantoClient({
    apiKey: KEY,
    baseUrl: BASE_URL,
    timeout: 90_000,
    fetch: async (url, init) => {
      const res = await fetch(url, init);
      bodies.push(await res.clone().json().catch(() => null));
      return res;
    },
  });
  return { client, last: () => bodies.at(-1) };
}

describe('live: no key needed', () => {
  it('the published spec has not drifted', async () => {
    const live = await (await fetch(`${BASE_URL}/openapi.json`)).json();
    expect(live.info.version).toBe(SPEC.info.version);
    expect(live.components.schemas, 'The live API spec changed: update test/data/openapi.json and the SDK.').toEqual(
      SPEC.components.schemas
    );
  });

  it('ready', async () => {
    expect(await new LevantoClient({ apiKey: 'unused', baseUrl: BASE_URL }).ready()).toBe(true);
  });

  it('a bad key is an AuthError', async () => {
    const err = await new LevantoClient({ apiKey: 'lv_live_not_a_real_key', baseUrl: BASE_URL }).yesno('text', 'Is this a test?').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(401);
  });
});

describe.skipIf(!KEY)('live: with LEVANTO_API_KEY', () => {
  it.each([
    ['yesno', TICKET, new YesNo('Is this ticket revenue-impacting?'), 'YesNoDecideResponsePublic'],
    ['choice', TICKET, new Choice('Which team owns this first?', ['billing', 'engineering', 'sales']), 'ChoiceDecideResponsePublic'],
    ['scale', TICKET, new Scale('How urgent is this ticket?', LEVELS), 'ScaleDecideResponsePublic'],
    ['sort', INCIDENTS, new Sort('Most urgent first'), 'SortDecideResponsePublic'],
    [
      'tags',
      TICKET,
      new Tags([{ id: 'outage', name: 'outage: something is down or failing' }, 'billing'], { instructions: 'Tag what the ticket reports.' }),
      'TagsDecideResponsePublic',
    ],
  ] as Array<[string, string | typeof INCIDENTS, Question, string]>)('%s', async (_, document, question, schema) => {
    const { client, last } = capturing();
    const env = await client.decide(document, question);
    expectValidResponse(last(), schema);
    expect(env).toEqual(last());
    expect(env.kind).toBe(question.kind);
  });

  it('answers are sensible', async () => {
    const { client } = capturing();
    expect((await client.yesno(TICKET, 'Is this ticket revenue-impacting?')).answer).toBe('yes');
    expect((await client.sort(INCIDENTS, 'Most urgent first')).sorted[0]).toBe('db_down');
    expect((await client.scale(TICKET, 'How urgent is this ticket?', LEVELS)).expectation).toBeGreaterThan(2.5);
  });

  it('reasoning off and on', async () => {
    const { client } = capturing();
    const off = await client.decide(TICKET, new YesNo('Is this ticket revenue-impacting?'), { reasoning: 'off' });
    expect(off.meta.reasoning?.ran).toBe(false);
    const on = await client.decide(TICKET, new YesNo('Is this ticket revenue-impacting?'), { reasoning: 'on' });
    expect(on.meta.reasoning?.ran).toBe(true);
  });

  it('batch groups with an image and a sort', async () => {
    const { client, last } = capturing();
    const out = await client.decideGroups(
      [
        { document: TICKET, questions: [new YesNo('Revenue-impacting?'), new Scale('How urgent?', LEVELS, { id: 'urgency' })] },
        { document: INCIDENTS, questions: [new Sort('Most urgent first')] },
        { document: imageFromBytes(samples.PNG_BLUE, { text: 'Is this image mostly blue?' }), questions: [new YesNo('Is the image mostly blue?')] },
      ],
      { reasoning: 'off' }
    );
    expectValidResponse(last(), 'BatchDecideResponsePublic');
    const items = out.flatMap((g) => g.items);
    expect(items.every((i) => i.ok), JSON.stringify(items)).toBe(true);
    expect(items.map((i) => i.id)).toEqual(['q0', 'urgency', 'q0', 'q0']);
    expect(out[2].items[0].meta?.usage?.image_count).toBe(1);
  });

  it('a failing batch question is isolated', async () => {
    const { client, last } = capturing();
    const items = await client.decide(TICKET, [new YesNo('Revenue-impacting?'), new Sort('Rank')]);
    expectValidResponse(last(), 'BatchDecideResponsePublic');
    expect(items[0].ok).toBe(true);
    expect(items[1].ok).toBe(false);
    expect(items[1].error).toBeTruthy();
  });

  it('an invalid request is a ValidationError', async () => {
    const { client } = capturing();
    const err = await client.decide(TICKET, new Scale('How urgent?', LEVELS.slice(0, 4))).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.status).toBe(400);
  });
});
