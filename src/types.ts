/** The five decision kinds Sage supports. */
export type Kind = 'yesno' | 'choice' | 'scale' | 'sort' | 'tags';

// ---------------------------------------------------------------------------
// Document (content) shapes
// ---------------------------------------------------------------------------

/** Explicit single-document text form. */
export interface TextContent {
  kind: 'text';
  value: string;
}

/** One item in a list document. */
export interface ListItem {
  id: string;
  content: string;
}

/** Explicit list form (e.g. for `sort` or multi-item scoring). */
export interface ListContent {
  kind: 'list';
  value: ListItem[];
}

/** The normalized content that goes on the wire. */
export type Content = string | TextContent | ListContent;

/**
 * What callers may pass as a `document`:
 * - a bare string (sent as-is; the API treats it as text),
 * - an explicit `{ kind: 'text' | 'list', value }` object (passed through),
 * - a bare array of `{ id, content }` items (wrapped as `{ kind: 'list', value }`).
 *
 * List content items must be `{ id, content }`; the API rejects bare strings.
 */
export type DocumentInput = string | TextContent | ListContent | ListItem[];

// ---------------------------------------------------------------------------
// Result payloads, one per kind
// ---------------------------------------------------------------------------

export interface YesNoResult {
  probability: number;
  confidence: number;
  /** The raw API value: `'yes'` when `probability >= 0.5`, else `'no'`. */
  answer: 'yes' | 'no';
}

export interface ChoiceProbability {
  option: string;
  probability: number;
}

export interface ChoiceResult {
  chosen: string;
  confidence: number;
  probabilities: ChoiceProbability[];
}

export interface ScaleResult {
  expectation: number;
  confidence: number;
}

export interface SortResult {
  sorted: string[];
  /** The API types this as nullable; never assume it is a number. */
  confidence: number | null;
}

export interface TagResult {
  id: string;
  probability: number;
  confidence: number;
  /** `boolean` when the tag was created with a `threshold`, otherwise `null`. */
  applies?: boolean | null;
}

export interface TagsResult {
  tags: TagResult[];
}

/** Union of every result payload. */
export type Result =
  | YesNoResult
  | ChoiceResult
  | ScaleResult
  | SortResult
  | TagsResult;

/** Maps a decision kind to its result payload type. */
export interface ResultForKind {
  yesno: YesNoResult;
  choice: ChoiceResult;
  scale: ScaleResult;
  sort: SortResult;
  tags: TagsResult;
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export interface Meta {
  model: string;
  latency_ms: number;
}

/** Metadata returned when grounding (web search) ran for a decision. */
export interface GroundingMeta {
  triggered: boolean;
  queries?: string[];
  sources?: unknown[];
  [key: string]: unknown;
}

/** The full response for a single `decide` call. */
export interface DecideEnvelope<K extends Kind = Kind> {
  id: string;
  kind: K;
  result: ResultForKind[K];
  meta: Meta;
  grounding_meta?: GroundingMeta;
}

/**
 * One entry in a batch result, aligned to the input question order.
 *
 * A successful item (`ok: true`) reads exactly like a single `decide`: `result`
 * is the bare payload (same shape as `DecideEnvelope.result`), with `meta` and,
 * when grounding ran, `grounding_meta` alongside it. A failed item (`ok: false`)
 * carries `error` instead. On the wire the server nests a full envelope under
 * each item's `result`; the client flattens it so access matches single decide.
 */
export interface BatchItem {
  id: string;
  kind: Kind;
  ok: boolean;
  result?: Result;
  meta?: Meta;
  grounding_meta?: GroundingMeta;
  error?: string;
}

/**
 * One group of a grouped batch (`decideGroups`), aligned to the input groups.
 * `items` are the flattened `BatchItem`s for that group's questions, in order.
 */
export interface GroupResult {
  items: BatchItem[];
}
