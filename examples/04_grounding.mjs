// Grounding: let the server augment a low-confidence decision with web search.
//
// Run:  LEVANTO_API_KEY=lv_live_... node examples/04_grounding.mjs
import { LevantoClient, YesNo } from 'levanto';

const apiKey = process.env.LEVANTO_API_KEY;
if (!apiKey) {
  console.error('Set LEVANTO_API_KEY to run this example.');
  process.exit(1);
}

const client = new LevantoClient({ apiKey });

// Grounding is attached to the question; on the wire it is lifted to a
// top-level sibling. `confidenceFloor` maps to `confidence_floor`; any other
// key (e.g. max_results) passes through by its wire name.
const env = await client.decide(
  'Acme Corp is a mid-size logistics firm founded in 2011.',
  new YesNo('Is Acme Corp currently in bankruptcy proceedings?', {
    grounding: { trigger: 'always', confidenceFloor: 0.85, max_results: 5 },
  })
);

console.log('answer :', env.result.answer, `(conf ${env.result.confidence})`);

if (env.grounding_meta) {
  console.log('grounded  :', env.grounding_meta.triggered);
  console.log('reason    :', env.grounding_meta.trigger_reason);
  console.log('queries   :', env.grounding_meta.queries);
  console.log('n_sources :', env.grounding_meta.sources?.length ?? 0);
} else {
  console.log('grounding did not run for this decision.');
}
