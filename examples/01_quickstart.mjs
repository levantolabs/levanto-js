// Quick start: create a client, make one decision, use a shortcut.
//
// Run:  LEVANTO_API_KEY=lv_live_... node examples/01_quickstart.mjs
import { LevantoClient, YesNo } from 'levanto';

const apiKey = process.env.LEVANTO_API_KEY;
if (!apiKey) {
  console.error('Set LEVANTO_API_KEY to run this example.');
  process.exit(1);
}

const client = new LevantoClient({ apiKey });

const doc = 'Marketing email: "Risk-free, guaranteed 40% returns for accredited investors."';

// decide() returns the full envelope: { id, kind, result, meta, grounding_meta? }
const env = await client.decide(doc, new YesNo('Does this need compliance review?'));
console.log('answer     :', env.result.answer); // 'yes' | 'no'
console.log('probability:', env.result.probability);
console.log('confidence :', env.result.confidence);
console.log('latency_ms :', env.meta.latency_ms);

// Shortcuts (client.yesno / choice / scale / sort / tags) return just the result payload.
const r = await client.yesno(doc, 'Does this need compliance review?');
console.log('shortcut   :', r.answer, r.probability);
