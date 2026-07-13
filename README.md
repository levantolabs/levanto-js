# levanto (JS/TS)

Thin, typed client for the Levanto Sage decision API. One `LevantoClient`, five decision kinds (Yes/No, Choice, Scale, Sort, Tags), zero runtime dependencies (native `fetch`, Node 18+).

**Docs:** [docs.levanto.ai](https://docs.levanto.ai) · Have an issue or want to leave feedback? Let us know at [team@levanto.ai](mailto:team@levanto.ai).

This README is a complete reference: every exported function and type, every default, and the behaviors that are not obvious from the signatures.

## Install

```bash
npm install levanto
```

## Quick start

```ts
import { LevantoClient, YesNo, Scale } from 'levanto';

const client = new LevantoClient({ apiKey: process.env.LEVANTO_API_KEY! });

const doc = 'Marketing email: "Risk-free, guaranteed 40% returns for accredited investors."';

// One decision -> full envelope
const env = await client.decide(doc, new YesNo('Needs compliance review?'));
console.log(env.result.answer);        // 'yes' | 'no'

// Shortcut -> just the result payload
const r = await client.yesno(doc, 'Needs compliance review?');
console.log(r.probability, r.confidence, r.answer);

// Batch: same document, many questions -> aligned array.
// Scale takes exactly 5 levels (0..4); a list of 5 strings maps to those levels by index.
const severity = ['none', 'low', 'moderate', 'high', 'severe'];
const items = await client.decide(doc, [new YesNo('Urgent?'), new Scale('How severe?', severity)]);
// Each item reads like a single decide, plus `ok`:
if (items[0].ok) console.log(items[0].result);   // { probability, confidence, answer }
```

## Exports

`LevantoClient`, and the types `LevantoClientOptions`, `QuestionGroup`, `FetchLike`.
Question constructors `YesNo`, `Choice`, `Scale`, `Sort`, `Tags`, and the types `Question`, `Grounding`, `Trigger`, `ChoiceOption`, `ScaleLevel`, `ScaleLevelValue`, `TagSpec`, `GroundedOpts`, `TagsOpts`, `IdOpts`.
Result/envelope types `Kind`, `DocumentInput`, `Content`, `TextContent`, `ListContent`, `ListItem`, `Meta`, `GroundingMeta`, `YesNoResult`, `ChoiceProbability`, `ChoiceResult`, `ScaleResult`, `SortResult`, `TagResult`, `TagsResult`, `Result`, `ResultForKind`, `DecideEnvelope`, `BatchItem`, `GroupResult`.
Errors `LevantoError`, `AuthError`, `ValidationError`, `ServiceUnavailableError`, `LevantoAPIError`.
Constant `VERSION`.

## LevantoClient

```ts
new LevantoClient(options: LevantoClientOptions)
```

Throws `LevantoError` if `apiKey` is missing.

`LevantoClientOptions`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | `string` | required | Sent as `Authorization: Bearer <apiKey>`. |
| `baseUrl` | `string` | `'https://sage.levanto.ai'` | Trailing slashes are stripped. |
| `timeout` | `number` | `60000` | Per-attempt timeout in milliseconds (via `AbortController`). |
| `maxRetries` | `number` | `3` | Retries on transient failures (see Behaviors). |
| `fetch` | `FetchLike` | global `fetch` | Transport override, mainly for tests. `FetchLike = (input: string, init: RequestInit) => Promise<Response>`. |

### decide

```ts
decide<Q extends Question>(document: DocumentInput, question: Q): Promise<DecideEnvelope<Q['kind']>>
decide(document: DocumentInput, questions: Question[]): Promise<BatchItem[]>
```

A single question calls `POST /decide` and returns the full envelope, typed to the question's kind. An array of questions calls `POST /decide/batch` as a single group (the shared document is sent once, not repeated per question) and returns a `BatchItem[]` aligned to input order.

### decideGroups

```ts
decideGroups(groups: QuestionGroup[]): Promise<GroupResult[]>
```

Score several documents in one round-trip, each with its own questions. Returns one `GroupResult` (`{ items: BatchItem[] }`) per input group, in order; each group's `items` are aligned to that group's questions (same flattened shape as `decide`).

```ts
interface QuestionGroup { document: DocumentInput; questions: Question[] }

const [postResult, commentResult] = await client.decideGroups([
  { document: post,    questions: [new YesNo('Violates policy?'), new Scale('How harmful?', severity)] },
  { document: comment, questions: [new YesNo('Is this spam?')] },
]);
postResult.items[0].result;   // yes/no payload for the post
```

### Shortcuts

Each shortcut builds the matching question, makes one single (non-batch) decision, and returns just the `result` payload.

```ts
yesno (document: DocumentInput, instructions: string, opts?: GroundedOpts): Promise<YesNoResult>
choice(document: DocumentInput, instructions: string, options: Array<string | ChoiceOption>, opts?: GroundedOpts): Promise<ChoiceResult>
scale (document: DocumentInput, instructions: string, levels: Array<string | ScaleLevel>, opts?: GroundedOpts): Promise<ScaleResult>
sort  (items: DocumentInput, instructions: string, opts?: IdOpts): Promise<SortResult>
tags  (document: DocumentInput, tags: Array<string | TagSpec>, opts?: TagsOpts): Promise<TagsResult>
```

`sort` takes the list to order as its first argument. `opts` defaults to `{}`.

### ready

```ts
ready(): Promise<boolean>
```

Calls `GET /ready` with no `Authorization` header. Returns `true` on HTTP 200, `false` on anything else (503 means still loading). Never retried, never throws (transport errors resolve to `false`).

## Question constructors

Distinct class per kind, forming the discriminated union `Question` keyed on `kind`. Shortcuts on the client are lowercase (`client.yesno`) so they never collide with the constructors (`YesNo`).

```ts
new YesNo (instructions: string, opts?: GroundedOpts)                                          // kind: 'yesno'
new Choice(instructions: string, options: Array<string | ChoiceOption>, opts?: GroundedOpts)   // kind: 'choice'
new Scale (instructions: string, levels: Array<string | ScaleLevel>, opts?: GroundedOpts)      // kind: 'scale'
new Sort  (instructions: string, opts?: IdOpts)                                                // kind: 'sort'  (no grounding)
new Tags  (tags: Array<string | TagSpec>, opts?: TagsOpts)                                     // kind: 'tags'  (instructions optional, via opts)
```

Options bags:

```ts
interface GroundedOpts { id?: string; grounding?: Grounding }             // kinds that support grounding
interface TagsOpts extends GroundedOpts { instructions?: string }         // tags: grounding + optional instruction
interface IdOpts       { id?: string }                                    // sort only
```

Shorthands applied at construction:
- `Choice(instr, ['approve', 'revise'])`: each bare string becomes `{ option }`.
- `Scale(instr, ['worst', 'bad', 'ok', 'good', 'best'])`: the 5 strings map to levels `0..4` by index.
- `Tags(['pii', 'toxicity'])`: each bare string becomes `{ id }`.

Explicit object forms are always accepted and passed through unchanged.

Per-kind fields:

| Field | yesno | choice | scale | sort | tags |
|---|:--:|:--:|:--:|:--:|:--:|
| `instructions` | required | required | required | required | optional |
| `options` / `levels` / `tags` | - | `options` req | `levels` req | - | `tags` req |
| `id` | opt | opt | opt | opt | opt |
| `grounding` | opt | opt | opt | no | opt |

## Sub-types

```ts
interface ChoiceOption { option: string; description?: string }
type ScaleLevelValue = 0 | 1 | 2 | 3 | 4
interface ScaleLevel  { level: ScaleLevelValue; description?: string }  // exactly 5 rungs, values 0..4; description optional
interface TagSpec     { id: string; name?: string; threshold?: number }// name optional; threshold 0..1, when set the result carries `applies`
type Trigger = 'never' | 'low_confidence' | 'always'
interface Grounding {
  trigger?: Trigger;
  confidenceFloor?: number;      // serialized to `confidence_floor`
  [key: string]: unknown;        // extra keys pass through unchanged
}
```

## Documents

```ts
interface TextContent { kind: 'text'; value: string }
interface ListItem    { id: string; content: string }
interface ListContent { kind: 'list'; value: ListItem[] }
type Content       = string | TextContent | ListContent
type DocumentInput = string | TextContent | ListContent | ListItem[]
```

Normalization: a bare string is sent as-is (the API treats it as text); a bare array of `{ id, content }` items is wrapped as `{ kind: 'list', value: items }`; explicit `{ kind: 'text' | 'list' }` objects pass through. List items must be `{ id, content }` (the API rejects bare strings). Sort takes a list; the other kinds take text.

## Grounding

Attach a `Grounding` object to any non-`sort` question (or pass it via a shortcut's `opts`) to let the server augment low-confidence decisions with web search. On the wire, grounding is lifted from the question to a top-level `grounding` sibling of `content`/`question`.

Grounding is thin: only the fields you set are sent, and the server applies its defaults for anything omitted. The `Grounding` type first-classes `trigger` and `confidenceFloor` (the latter is renamed to `confidence_floor` on the wire); every other key passes through unchanged, so the remaining server knobs are set by their wire names via the index signature.

Full grounding config (wire field, SDK access, default, range):

| Wire field | SDK | Default | Range |
|---|---|---|---|
| `trigger` | `trigger` | `'low_confidence'` | `'never'` \| `'low_confidence'` \| `'always'` |
| `confidence_floor` | `confidenceFloor` | `0.80` | `0.0 .. 1.0` |
| `max_results` | `max_results` (pass-through) | `10` | `1 .. 20` |
| `max_context_tokens` | `max_context_tokens` (pass-through) | `2000` | `1 .. 8000` |
| `return_sources` | `return_sources` (pass-through) | `true` | boolean |

```ts
new YesNo('Is Acme currently bankrupt?', {
  grounding: { trigger: 'low_confidence', confidenceFloor: 0.85, max_results: 8, return_sources: true },
});
```

The floor is a confidence threshold, interpreted per kind: for yesno/scale/choice, search fires when the decision `confidence` is below it (yesno confidence is decisiveness `2·|p−0.5|`); for tags, it is weakest-link (search fires if any tag's confidence is below the floor). This is distinct from `TagSpec.threshold`, which controls a tag's `applies` flag. When grounding runs, the envelope includes a `grounding_meta` block (`{ triggered, trigger_reason?, queries?, sources?, added_context_tokens?, search_ms? }`).

## Return types

```ts
interface YesNoResult { probability: number; confidence: number; answer: 'yes' | 'no' }
interface ChoiceProbability { option: string; probability: number }
interface ChoiceResult { chosen: string; confidence: number; probabilities: ChoiceProbability[] }
interface ScaleResult  { expectation: number; confidence: number }
interface SortResult   { sorted: string[]; confidence: number | null }   // confidence is nullable per the API; never assume a number
interface TagResult    { id: string; probability: number; confidence: number; applies?: boolean | null }  // boolean when the tag had a threshold, else null
interface TagsResult   { tags: TagResult[] }
type Result = YesNoResult | ChoiceResult | ScaleResult | SortResult | TagsResult

interface Meta { model: string; latency_ms: number }
interface GroundingMeta { triggered: boolean; queries?: string[]; sources?: unknown[]; [key: string]: unknown }

interface DecideEnvelope<K extends Kind = Kind> {
  id: string;
  kind: K;
  result: ResultForKind[K];      // ResultForKind maps a kind to its result type
  meta: Meta;
  grounding_meta?: GroundingMeta;
}

interface BatchItem {            // one entry per input question, in order
  id: string;
  kind: Kind;
  ok: boolean;
  result?: Result;               // bare payload on success — same shape as DecideEnvelope.result
  meta?: Meta;                   // present on success
  grounding_meta?: GroundingMeta;// present only when grounding ran for that item
  error?: string;                // present on failure (ok: false)
}

interface GroupResult {          // one entry per input group of decideGroups(), in order
  items: BatchItem[];            // aligned to that group's questions
}
```

A successful `BatchItem` reads exactly like a single `decide`: `item.result.answer` is the payload (not `item.result.result.answer`), with `item.meta` alongside. On the wire the server nests a full envelope under each item's `result`; the client flattens it for you. `answer` is the raw API string `'yes'` / `'no'`, not a boolean. `SortResult.confidence` is typed nullable by the API, so never assume it is a number. `TagResult.applies` is a boolean when that tag was created with a `threshold`, otherwise `null`.

## Errors

```ts
class LevantoError extends Error { readonly status?: number; readonly detail?: string }
class AuthError               extends LevantoError   // 401, 402
class ValidationError         extends LevantoError   // 400, 422
class ServiceUnavailableError extends LevantoError   // 503
class LevantoAPIError         extends LevantoError   // any other non-2xx
```

Every API error carries the HTTP `status` and the server `detail` string. A per-attempt timeout raises a `LevantoError`; an exhausted retry on a transport failure also raises a `LevantoError`.

## Behaviors

- **id defaulting**: if a question has no `id`, the SDK fills one. A single call defaults to the kind string (e.g. `'yesno'`); a batch assigns `q0, q1, ...` by index. A supplied `id` is kept.
- **Batch**: `decide(doc, questions[])` sends one group (shared content once) and `decideGroups` sends several. `BatchItem`s come back in question order, with `id`/`kind` from each request's question. On success the server's nested envelope is flattened onto the item (`result`, `meta`, and `grounding_meta` when present); on failure the item carries `error`.
- **Batch error modes**: a schema-invalid question (e.g. wrong scale level count) rejects the *whole* batch with a `ValidationError`. A question that is well-formed but incompatible with its group's shared content (e.g. a `sort` question over text content) is isolated: that `BatchItem` comes back `ok: false` with an `error`, while the others succeed. (Unlike single `decide`, a batch group accepts any content/kind combination and isolates the mismatches.)
- **Retries**: transport errors and HTTP `429, 500, 502, 503, 504` are retried up to `maxRetries`, with exponential backoff plus jitter (base 250ms, capped at 20s). `ready()` is never retried.
- **Timeout**: each attempt is bounded by `timeout` (default 60000ms) via `AbortController`.

## Limits (enforced server-side, surfaced as `ValidationError`)

- choice: 2..120 options
- scale: exactly 5 levels, values `0..4`
- sort: 2..120 items
- tags: 1..120 tags; `threshold` in `0..1`
- The full rendered request must fit within roughly 32K tokens.

## License

MIT
