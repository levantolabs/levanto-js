/** Response types: plain objects, exactly as the API sends them (snake_case). */

export type Kind = 'yesno' | 'choice' | 'scale' | 'sort' | 'tags';

/** `auto` (server default) reasons only when needed, `off` never, `on` always. */
export type Reasoning = 'auto' | 'off' | 'on';

// --- content -----------------------------------------------------------------

export interface TextContent {
  kind: 'text';
  value: string;
}

/** Image content (beta): a base64 `data:` URI (PNG, JPEG, WebP) plus optional text. */
export interface ImageContent {
  kind: 'image';
  media: string;
  text?: string;
}

/** One item to sort. */
export interface ListItem {
  id: string;
  content: string;
}

export interface ListContent {
  kind: 'list';
  value: ListItem[];
}

export type Content = string | TextContent | ImageContent | ListContent;

/** What a `document` can be: text, image, list content, or a bare array of items (Sort). */
export type DocumentInput = Content | ListItem[];

// --- results -----------------------------------------------------------------

export interface YesNoResult {
  /** `null`: Sage isn't sure. */
  answer: 'yes' | 'no' | null;
  /** Calibrated P(yes). */
  probability: number;
}

export interface ChoiceProbability {
  option: string;
  probability: number;
}

export interface ChoiceResult {
  /** `null`: the top options are too close to call. */
  chosen: string | null;
  /** P(`chosen` is correct); `null` when `chosen` is `null`. */
  probability: number | null;
  /** Every option in request order. Independent: they don't sum to 1. */
  probabilities: ChoiceProbability[];
}

export interface ScaleResult {
  /** 0..4 */
  expectation: number;
  confidence: number;
}

export interface SortResult {
  /** Item ids, in order. */
  sorted: string[];
  confidence: number | null;
}

export interface TagResult {
  id: string;
  /** Calibrated P(tag applies). */
  probability: number;
  /** Sage's verdict; `null` when too close to call. */
  applies: boolean | null;
}

export interface TagsResult {
  tags: TagResult[];
}

export interface ResultForKind {
  yesno: YesNoResult;
  choice: ChoiceResult;
  scale: ScaleResult;
  sort: SortResult;
  tags: TagsResult;
}

export type Result = ResultForKind[Kind];

// --- meta --------------------------------------------------------------------

export interface Usage {
  billed_input_tokens: number;
  rendered_tokens?: number | null;
  image_count?: number;
  image_tokens?: number;
}

export interface ReasoningMeta {
  /** The first pass signalled the question needs reasoning. */
  fired: boolean;
  /** The reasoning pass executed. */
  ran: boolean;
  /** `false`: the first-pass answer was returned; `null`: it didn't run. */
  finished?: boolean | null;
  tokens?: number | null;
  margin?: number | null;
  limited?: 'cap' | 'timeout' | 'budget' | null;
}

export interface Meta {
  model: string;
  latency_ms?: number | null;
  question_count?: number | null;
  compute_mode?: string | null;
  usage?: Usage | null;
  /** Omitted on kinds without a reasoning pass. */
  reasoning?: ReasoningMeta | null;
}

export interface Source {
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
}

export interface GroundingMeta {
  triggered: boolean;
  trigger_reason?: string | null;
  queries?: string[];
  sources?: Source[];
  added_context_tokens?: number | null;
  search_ms?: number | null;
}

// --- envelopes ---------------------------------------------------------------

/** A `/decide` response. `grounding_meta` is present when grounding was requested. */
export interface DecideEnvelope<K extends Kind = Kind> {
  id: string;
  kind: K;
  result: ResultForKind[K];
  meta: Meta;
  grounding_meta?: GroundingMeta | null;
}

/**
 * One batch answer, in question order. `ok: true` reads like a single decide
 * (`result`, `meta`, `grounding_meta`); `ok: false` carries `error`.
 */
export interface BatchItem {
  id: string;
  kind: Kind;
  ok: boolean;
  result?: Result;
  meta?: Meta;
  grounding_meta?: GroundingMeta | null;
  error?: string;
}

export interface GroupResult {
  items: BatchItem[];
}
