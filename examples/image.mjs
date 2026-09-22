// Judge a screenshot with its ticket. Run: node examples/image.mjs screenshot.png (LEVANTO_API_KEY set, after npm run build).
import { readFile } from 'node:fs/promises';
import { LevantoClient, imageFromBytes } from '../dist/index.js';

const client = new LevantoClient();
const shot = imageFromBytes(await readFile(process.argv[2]), { text: 'Ticket: the checkout button is missing on mobile.' });
console.log(await client.yesno(shot, 'Does the screenshot show the reported problem?'));
