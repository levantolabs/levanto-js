# levanto

TypeScript/JavaScript client for the [Levanto Sage](https://docs.levanto.ai) decision API (v1.1). Fully typed, zero dependencies (native `fetch`), ESM and CommonJS.

```bash
npm install levanto
```

Requires Node 20+ (or any runtime with `fetch`).

## Quick start

```ts
import { LevantoClient } from 'levanto';

const client = new LevantoClient(); // reads LEVANTO_API_KEY, or pass { apiKey: 'lv_live_...' }

const r = await client.yesno("Marketing email: 'Guaranteed 40% returns, risk-free.'", 'Needs compliance review?');

if (r.answer === null) sendToHuman();        // Sage isn't sure
else if (r.answer === 'yes') sendToCompliance();
```

Results are plain objects, exactly as the API returns them (snake_case). A `null` answer is a real answer ("not sure"), not an error: route it to a person.

## Decision kinds

| Shortcut | Returns |
|---|---|
| `client.yesno(doc, instructions)` | `{ answer: 'yes' \| 'no' \| null, probability }` (P(yes)) |
| `client.choice(doc, instructions, ['a', 'b'])` | `{ chosen: string \| null, probability: number \| null, probabilities: [{ option, probability }] }` |
| `client.scale(doc, instructions, [5 level descriptions])` | `{ expectation: 0..4, confidence }` |
| `client.sort([{ id, content }, …], instructions)` | `{ sorted: [ids], confidence: number \| null }` |
| `client.tags(doc, ['spam', { id: 'scam', name: 'scam: fraud or phishing' }], { instructions })` | `{ tags: [{ id, probability, applies: boolean \| null }] }` |

Every shortcut also takes `{ id, reasoning }`, and (except `sort`) `grounding`.

For the full response (`id`, `kind`, `result`, `meta`, `grounding_meta`), use `decide` with a question object. The result type follows the question:

```ts
import { Choice } from 'levanto';

const env = await client.decide(doc, new Choice('How should legal handle this?', [
  { option: 'approve', description: 'Standard terms, no red flags' },
  { option: 'escalate', description: 'Unusual or high-risk terms' },
]));
env.result.chosen; // string | null
```

Question classes: `YesNo`, `Choice`, `Scale`, `Sort`, `Tags`.

## Batch

An array of questions about one document is a single call; the document is sent once. You get one item per question, in order:

```ts
const items = await client.decide(doc, [new YesNo('Violates policy?'), new Scale('How harmful?', levels)]);
for (const item of items) console.log(item.ok ? item.result : item.error);
```

Several documents in one call:

```ts
const groups = await client.decideGroups([
  { document: post, questions: [new YesNo('Spam?')] },
  { document: comment, questions: [new YesNo('Spam?'), new Tags(['abuse'])] },
]);
groups[1].items[0].result;
```

A question that fails comes back with `ok: false` and `error`; the others still succeed. Unset ids default to `q0`, `q1`, …

## Reasoning

Sage v1.1 can think a hard question through before answering. `'auto'` (the server default) reasons only when the question needs it; `'off'` never does; `'on'` always does. Reasoning is not billed.

```ts
const client = new LevantoClient({ reasoning: 'off' });                   // default for every call
await client.decide(doc, new YesNo('Refund allowed?'), { reasoning: 'on' }); // override one call
env.meta.reasoning; // { fired, ran, finished, tokens, margin, limited }
```

A reasoning pass has a 6 s budget; keep `timeout` above that (the default is 60 s).

## Images (beta)

Yes/No, Choice (at most 20 options), Scale, and Tags accept an image. PNG, JPEG, or WebP, up to 4 MiB:

```ts
import { readFile } from 'node:fs/promises';
import { imageFromBytes } from 'levanto';

const shot = imageFromBytes(await readFile('screenshot.png'), { text: 'Ticket: checkout button missing' });
await client.yesno(shot, 'Does the screenshot show the reported problem?');
```

Already have a `data:` URI? Use `image(dataUri, text?)`. Images can't be used with `sort`, inside list items, or with grounding.

## Grounding

Optional web search before deciding, for recency- or fact-heavy questions:

```ts
await client.yesno(doc, 'Is Acme currently bankrupt?', { grounding: { trigger: 'low_confidence', confidenceFloor: 0.8 } });
```

Fields: `trigger` (`'never'`, `'low_confidence'`, `'always'`), `confidenceFloor`, `maxResults`, `maxContextTokens`, `returnSources`. Unset fields use the server defaults. When grounding was requested, the response has `grounding_meta`.

## Client options

```ts
new LevantoClient({ apiKey, baseUrl = 'https://sage.levanto.ai', timeout = 60_000, maxRetries = 3, reasoning, fetch });
```

`client.ready()` resolves `true` when Sage is serving.

## Errors

All errors are `LevantoError`, with `status` and the server's `detail`.

| Error | When |
|---|---|
| `ValidationError` | 400/422: invalid request or a [limit](https://docs.levanto.ai/decision-model/limits) broken |
| `AuthError` | 401: missing or invalid API key |
| `AllowanceExhaustedError` | 402: this period's decisions are used up (extends `AuthError`) |
| `ServiceUnavailableError` | 503 after retries |
| `LevantoAPIError` | any other status |
| `LevantoError` | network failure or timeout (`status` is undefined) |

Network errors and 429/500/502/503/504 are retried up to `maxRetries` times with exponential backoff (honouring `Retry-After`). Timeouts are not retried, so a slow call is never billed twice.

## Upgrading from 0.1

- Yes/No and Choice no longer return `confidence`. Route on `answer` / `chosen` (`null` means not sure), or on `probability`.
- `answer`, `chosen`, and a tag's `applies` can be `null`.
- `TagSpec` is `{ id, name? }`; `threshold` is gone (the API ignores it). `applies` is Sage's own verdict.
- `Grounding` has explicit camelCase fields; unknown keys are no longer passed through.
- New: `reasoning`, `imageFromBytes` / `image`, `AllowanceExhaustedError`, full `meta` (`usage`, `reasoning`). Node 20+.

## Development

```bash
npm test                                       # unit + contract tests (no network)
npm run typecheck
LEVANTO_API_KEY=lv_live_... npm run test:live  # live tests (about 15 decisions)
```

Requests and responses are validated against the API spec in `test/data/openapi.json`; the live suite also fails if the published spec changes.

## License

MIT
