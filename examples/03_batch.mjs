// Batch: one document, many questions, in a single round-trip.
//
// Run:  LEVANTO_API_KEY=lv_live_... node examples/03_batch.mjs
import { LevantoClient, YesNo, Scale, Tags } from 'levanto';

const apiKey = process.env.LEVANTO_API_KEY;
if (!apiKey) {
  console.error('Set LEVANTO_API_KEY to run this example.');
  process.exit(1);
}

const client = new LevantoClient({ apiKey });

const doc = 'Marketing email: "Risk-free, guaranteed 40% returns for accredited investors."';
const severity = ['none', 'low', 'moderate', 'high', 'severe'];

// Passing an array of questions fans the same document across all of them and
// returns BatchItem[] aligned to input order.
const items = await client.decide(doc, [
  new YesNo('Needs compliance review?'),
  new Scale('How severe?', severity),
  new Tags(['financial', { id: 'pii', threshold: 0.5 }]),
]);

for (const item of items) {
  if (item.ok) {
    // A successful item reads exactly like a single decide: item.result + item.meta.
    console.log(`${item.id} (${item.kind}) ->`, JSON.stringify(item.result), `[${item.meta.latency_ms}ms]`);
  } else {
    console.log(`${item.id} (${item.kind}) FAILED:`, item.error);
  }
}

// Score several *different* documents in one round-trip, each with its own
// questions, via decideGroups. Returns one GroupResult per input group.
const groups = await client.decideGroups([
  { document: doc, questions: [new YesNo('Needs compliance review?')] },
  {
    document: 'The quarterly report looks solid and on-budget.',
    questions: [new YesNo('Needs compliance review?'), new Scale('How severe?', severity)],
  },
]);
groups.forEach((g, gi) => {
  console.log(`group ${gi}:`, g.items.map((i) => `${i.kind}=${i.ok ? JSON.stringify(i.result) : i.error}`).join('  '));
});
