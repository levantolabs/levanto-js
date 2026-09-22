// One document, several questions, one call; reasoning always on. Run with LEVANTO_API_KEY set (after npm run build).
import { LevantoClient, Scale, YesNo } from '../dist/index.js';

const client = new LevantoClient({ reasoning: 'on' });
const doc = 'Refunds within 30 days. Store credit up to 60 days for unopened items.\n\nOrder bought 41 days ago, box unopened. Customer asks for a cash refund.';

for (const item of await client.decide(doc, [
  new YesNo('Under the policy, should we issue a cash refund?'),
  new Scale('How likely is the customer to escalate?', ['none', 'low', 'medium', 'high', 'certain']),
])) {
  console.log(item.id, item.ok ? item.result : `failed: ${item.error}`, item.meta?.reasoning);
}
