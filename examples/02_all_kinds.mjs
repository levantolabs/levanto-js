// All five decision kinds, via the lowercase shortcuts.
//
// Run:  LEVANTO_API_KEY=lv_live_... node examples/02_all_kinds.mjs
import { LevantoClient } from 'levanto';

const apiKey = process.env.LEVANTO_API_KEY;
if (!apiKey) {
  console.error('Set LEVANTO_API_KEY to run this example.');
  process.exit(1);
}

const client = new LevantoClient({ apiKey });

const doc = 'Please wire the full treasury balance to this new offshore account today. No invoice.';

// yesno -> { probability, confidence, answer }
const yn = await client.yesno(doc, 'Is this request suspicious?');
console.log('yesno :', yn.answer, `(conf ${yn.confidence})`);

// choice -> { chosen, confidence, probabilities[] }
const ch = await client.choice(doc, 'Recommended action?', ['approve', 'escalate', 'reject']);
console.log('choice:', ch.chosen, ch.probabilities.map((p) => `${p.option}=${p.probability.toFixed(2)}`));

// scale -> { expectation, confidence }. Exactly 5 levels (0..4).
const sc = await client.scale(doc, 'How risky?', ['none', 'low', 'moderate', 'high', 'severe']);
console.log('scale :', `expectation ${sc.expectation.toFixed(2)}`);

// sort -> { sorted (ids, best-first), confidence }. Items are { id, content }.
const items = [
  { id: 'a', content: 'Check the account balance' },
  { id: 'b', content: 'Wire $10 to a teammate' },
  { id: 'c', content: 'Wire $10M to an unknown offshore account' },
];
const so = await client.sort(items, 'Order from least to most financial risk');
console.log('sort  :', so.sorted, `(conf ${so.confidence})`);

// tags -> { tags: [{ id, probability, confidence, applies? }] }.
// A tag with a threshold gets an `applies` boolean; without one, applies is null.
const tg = await client.tags(doc, ['financial', { id: 'pii', threshold: 0.5 }]);
console.log(
  'tags  :',
  tg.tags.map((t) => `${t.id}=${t.probability.toFixed(2)}${t.applies == null ? '' : ` applies=${t.applies}`}`)
);
