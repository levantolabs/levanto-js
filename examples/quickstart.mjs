// Every decision kind once. Run: npm run build && LEVANTO_API_KEY=lv_live_... node examples/quickstart.mjs
import { LevantoClient } from '../dist/index.js';

const client = new LevantoClient();
const ticket = 'Checkout returns a 500 for about 10% of EU customers since the deploy 20 minutes ago.';

console.log(await client.yesno(ticket, 'Is this revenue-impacting?'));
console.log(await client.choice(ticket, 'Which team owns this first?', ['billing', 'engineering', 'sales']));
console.log(await client.scale(ticket, 'How urgent?', ['none', 'low', 'medium', 'high', 'critical']));
console.log(await client.sort([{ id: 'typo', content: 'FAQ typo' }, { id: 'db', content: 'Database down' }], 'Most urgent first'));
console.log(await client.tags(ticket, [{ id: 'outage', name: 'outage: something is down' }, 'billing'], { instructions: 'Tag what it reports.' }));
