import { Http, type FetchLike } from './http';
import { LevantoError } from './errors';
import { VERSION } from './version';
import {
  YesNo,
  Choice,
  Scale,
  Sort,
  Tags,
  type Question,
  type Grounding,
  type GroundedOpts,
  type TagsOpts,
  type IdOpts,
  type ChoiceOption,
  type ScaleLevel,
  type TagSpec,
} from './questions';
import type {
  Content,
  DocumentInput,
  Kind,
  DecideEnvelope,
  BatchItem,
  GroupResult,
  YesNoResult,
  ChoiceResult,
  ScaleResult,
  SortResult,
  TagsResult,
} from './types';

const DEFAULT_BASE_URL = 'https://sage.levanto.ai';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 3;

export interface LevantoClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  /** Override the transport (mainly for tests / custom environments). */
  fetch?: FetchLike;
}

/** A shared document plus the questions to ask about it (one batch group). */
export interface QuestionGroup {
  document: DocumentInput;
  questions: Question[];
}

// --- Wire shapes (internal) ------------------------------------------------

interface WireQuestion {
  id: string;
  kind: Kind;
  instructions?: string;
  options?: ChoiceOption[];
  levels?: ScaleLevel[];
  tags?: TagSpec[];
}

interface WireRequest {
  content: Content;
  question: WireQuestion;
  grounding?: Record<string, unknown>;
}

/** A batch question embeds grounding inside the question (unlike single decide). */
interface WireBatchQuestion extends WireQuestion {
  grounding?: Record<string, unknown>;
}

/** One request group: a shared document plus the questions to ask about it. */
interface WireGroup {
  content: Content;
  questions: WireBatchQuestion[];
}

interface WireBatchRequest {
  requests: WireGroup[];
}

/** One answer inside a group's `answers`, in question order. */
interface WireAnswer {
  ok: boolean;
  /** On success the server nests a full single-decide envelope here. */
  result?: DecideEnvelope | null;
  error?: string | null;
}

interface WireGroupResult {
  answers: WireAnswer[];
}

interface WireBatchResponse {
  results: WireGroupResult[];
  meta: { request_count: number; question_count: number };
}

// --- Serialization helpers -------------------------------------------------

/** Normalize a caller `document` into the wire `content` shape. */
function normalizeContent(document: DocumentInput): Content {
  if (typeof document === 'string') return document;
  if (Array.isArray(document)) return { kind: 'list', value: document };
  return document;
}

/**
 * Translate a `Grounding` bag into wire form: `confidenceFloor` becomes
 * `confidence_floor`; every other key passes through unchanged.
 */
function serializeGrounding(g: Grounding): Record<string, unknown> {
  const { confidenceFloor, ...rest } = g;
  const out: Record<string, unknown> = { ...rest };
  if (confidenceFloor !== undefined) out.confidence_floor = confidenceFloor;
  return out;
}

/**
 * Build the wire `question` object plus the (top-level) grounding sibling.
 * Grounding is attached to the question for ergonomics but lifted here.
 */
function serializeQuestion(
  q: Question,
  id: string
): { question: WireQuestion; grounding?: Record<string, unknown> } {
  const question: WireQuestion = { id, kind: q.kind };
  // `instructions` is required for every kind except `tags`, where it is
  // optional; only emit it for tags when the caller actually set one.
  if (q.kind === 'tags') {
    if (q.instructions !== undefined) question.instructions = q.instructions;
  } else {
    question.instructions = q.instructions;
  }
  if (q.kind === 'choice') question.options = q.options;
  else if (q.kind === 'scale') question.levels = q.levels;
  else if (q.kind === 'tags') question.tags = q.tags;

  let grounding: Record<string, unknown> | undefined;
  if (q.kind !== 'sort' && q.grounding) {
    grounding = serializeGrounding(q.grounding);
  }
  return { question, grounding };
}

/**
 * Build a batch question. Unlike single `decide` (where grounding is lifted to
 * a top-level sibling), the batch wire form embeds grounding inside the question.
 */
function serializeBatchQuestion(q: Question, id: string): WireBatchQuestion {
  const { question, grounding } = serializeQuestion(q, id);
  const out: WireBatchQuestion = { ...question };
  if (grounding) out.grounding = grounding;
  return out;
}

/** Build one request group: shared content + its questions (ids default q0,q1,…). */
function buildGroup(document: DocumentInput, questions: Question[]): WireGroup {
  return {
    content: normalizeContent(document),
    questions: questions.map((q, i) => serializeBatchQuestion(q, q.id ?? `q${i}`)),
  };
}

/** Flatten a group's answers into BatchItem[], aligned to the input questions. */
function flattenAnswers(
  questions: Question[],
  group: WireGroupResult | undefined
): BatchItem[] {
  return questions.map((q, i) => {
    const raw = group?.answers?.[i];
    const env = raw?.result ?? undefined;
    const item: BatchItem = { id: q.id ?? `q${i}`, kind: q.kind, ok: raw?.ok ?? false };
    // Flatten the nested envelope so a batch item reads like a single decide.
    if (env) {
      item.result = env.result;
      item.meta = env.meta;
      if (env.grounding_meta) item.grounding_meta = env.grounding_meta;
    }
    if (raw?.error != null) item.error = raw.error;
    return item;
  });
}

// --- Client ----------------------------------------------------------------

/** Client for the Levanto Sage decision API. */
export class LevantoClient {
  private readonly http: Http;

  constructor(options: LevantoClientOptions) {
    if (!options || !options.apiKey) {
      throw new LevantoError('LevantoClient requires an `apiKey`.');
    }
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.http = new Http({
      apiKey: options.apiKey,
      baseUrl,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      userAgent: `levanto-js/${VERSION}`,
      fetchImpl: options.fetch,
    });
  }

  /** One decision over a document. Returns the full envelope. */
  decide<Q extends Question>(
    document: DocumentInput,
    question: Q
  ): Promise<DecideEnvelope<Q['kind']>>;
  /** Fan the same document across N questions. Returns aligned batch items. */
  decide(document: DocumentInput, questions: Question[]): Promise<BatchItem[]>;
  decide(
    document: DocumentInput,
    question: Question | Question[]
  ): Promise<DecideEnvelope | BatchItem[]> {
    return Array.isArray(question)
      ? this.decideBatch(document, question)
      : this.decideSingle(document, question);
  }

  /**
   * Score several documents in one round-trip, each with its own questions.
   * Returns one `GroupResult` per input group, in order; each group's `items`
   * are aligned to that group's questions (same flattened shape as `decide`).
   */
  async decideGroups(groups: QuestionGroup[]): Promise<GroupResult[]> {
    const body: WireBatchRequest = {
      requests: groups.map((g) => buildGroup(g.document, g.questions)),
    };
    const response = await this.http.request<WireBatchResponse>('POST', '/decide/batch', body);
    return groups.map((g, i) => ({
      items: flattenAnswers(g.questions, response.results?.[i]),
    }));
  }

  /** Yes/no shortcut. Returns just the result payload. */
  async yesno(
    document: DocumentInput,
    instructions: string,
    opts: GroundedOpts = {}
  ): Promise<YesNoResult> {
    const env = await this.decideSingle(document, new YesNo(instructions, opts));
    return env.result as YesNoResult;
  }

  /** Choice shortcut. Returns just the result payload. */
  async choice(
    document: DocumentInput,
    instructions: string,
    options: Array<string | ChoiceOption>,
    opts: GroundedOpts = {}
  ): Promise<ChoiceResult> {
    const env = await this.decideSingle(document, new Choice(instructions, options, opts));
    return env.result as ChoiceResult;
  }

  /** Scale shortcut. Returns just the result payload. */
  async scale(
    document: DocumentInput,
    instructions: string,
    levels: Array<string | ScaleLevel>,
    opts: GroundedOpts = {}
  ): Promise<ScaleResult> {
    const env = await this.decideSingle(document, new Scale(instructions, levels, opts));
    return env.result as ScaleResult;
  }

  /** Sort shortcut. `items` is the list to order. Returns the result payload. */
  async sort(
    items: DocumentInput,
    instructions: string,
    opts: IdOpts = {}
  ): Promise<SortResult> {
    const env = await this.decideSingle(items, new Sort(instructions, opts));
    return env.result as SortResult;
  }

  /** Tags shortcut. Returns just the result payload. */
  async tags(
    document: DocumentInput,
    tags: Array<string | TagSpec>,
    opts: TagsOpts = {}
  ): Promise<TagsResult> {
    const env = await this.decideSingle(document, new Tags(tags, opts));
    return env.result as TagsResult;
  }

  /** Health check. `GET /ready`: true on 200, false otherwise. */
  ready(): Promise<boolean> {
    return this.http.ready();
  }

  // --- internals ---

  private decideSingle(
    document: DocumentInput,
    q: Question
  ): Promise<DecideEnvelope> {
    const content = normalizeContent(document);
    const { question, grounding } = serializeQuestion(q, q.id ?? q.kind);
    const body: WireRequest = { content, question };
    if (grounding) body.grounding = grounding;
    return this.http.request<DecideEnvelope>('POST', '/decide', body);
  }

  private async decideBatch(
    document: DocumentInput,
    questions: Question[]
  ): Promise<BatchItem[]> {
    // One document + N questions is a single group under the v0.5 batch API
    // (the shared content is sent once, not repeated per question).
    const body: WireBatchRequest = { requests: [buildGroup(document, questions)] };
    const response = await this.http.request<WireBatchResponse>('POST', '/decide/batch', body);
    return flattenAnswers(questions, response.results?.[0]);
  }
}
