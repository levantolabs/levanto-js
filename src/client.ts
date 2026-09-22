import { Http, type FetchLike } from './http';
import { LevantoError } from './errors';
import { VERSION } from './version';
import {
  Choice,
  Scale,
  Sort,
  Tags,
  YesNo,
  groundingToWire,
  type ChoiceOption,
  type GroundedOpts,
  type IdOpts,
  type Question,
  type ScaleLevel,
  type TagSpec,
  type TagsOpts,
} from './questions';
import type {
  BatchItem,
  BatchMeta,
  BatchResult,
  ChoiceResult,
  Content,
  DecideEnvelope,
  DocumentInput,
  GroupsResult,
  Reasoning,
  ScaleResult,
  SortResult,
  TagsResult,
  YesNoResult,
} from './types';

export interface LevantoClientOptions {
  /** Defaults to the `LEVANTO_API_KEY` environment variable (Node). */
  apiKey?: string;
  /** Default `https://sage.levanto.ai`. */
  baseUrl?: string;
  /** Per-attempt timeout in ms. Default 60000 (keep it above the 6 s reasoning budget). */
  timeout?: number;
  /** Retries for network errors and 429/500/502/503/504. Default 3. */
  maxRetries?: number;
  /** Default reasoning for every call. Unset: the server default (`auto`). */
  reasoning?: Reasoning;
  /** Custom `fetch` (tests, proxies, other runtimes). */
  fetch?: FetchLike;
}

/** Per-call options. `reasoning` overrides the client default; `null` sends none. */
export interface CallOpts {
  reasoning?: Reasoning | null;
}

/** One document plus the questions to ask about it (`decideGroups`). */
export interface QuestionGroup {
  document: DocumentInput;
  questions: Question[];
}

interface WireAnswer {
  ok: boolean;
  result?: DecideEnvelope | null;
  error?: string | null;
}

interface WireBatchResponse {
  results?: Array<{ answers?: WireAnswer[] }>;
  meta?: BatchMeta;
}

function withMeta<T>(list: T[], res: WireBatchResponse): T[] & { meta: BatchMeta } {
  return Object.assign(list, { meta: res.meta ?? ({} as BatchMeta) });
}

/** @internal */
export function toContent(document: DocumentInput): Content {
  if (Array.isArray(document)) return { kind: 'list', value: document };
  return document;
}

/** @internal Body for `POST /decide`: grounding is top-level; the id defaults to the kind. */
export function singleBody(document: DocumentInput, q: Question, reasoning?: Reasoning | null) {
  const body: Record<string, unknown> = { content: toContent(document), question: q.toWire(q.kind) };
  if (q.grounding) body.grounding = groundingToWire(q.grounding);
  if (reasoning) body.reasoning = reasoning;
  return body;
}

/** @internal Body for `POST /decide/batch`: grounding sits inside each question; ids default to q0, q1, … */
export function batchBody(groups: QuestionGroup[], reasoning?: Reasoning | null) {
  const requests = groups.map(({ document, questions }) => {
    if (questions.length === 0) throw new LevantoError('Every batch group needs at least one question.');
    return {
      content: toContent(document),
      questions: questions.map((q, i) => {
        const wire: Record<string, unknown> = { ...q.toWire(`q${i}`) };
        if (q.grounding) wire.grounding = groundingToWire(q.grounding);
        return wire;
      }),
    };
  });
  const body: Record<string, unknown> = { requests };
  if (reasoning) body.reasoning = reasoning;
  return body;
}

function flatten(questions: Question[], answers: WireAnswer[] = []): BatchItem[] {
  return questions.map((q, i) => {
    const raw = answers[i] ?? { ok: false, error: 'missing answer in response' };
    const item: BatchItem = { id: q.id ?? `q${i}`, kind: q.kind, ok: Boolean(raw.ok) };
    if (raw.result) {
      item.result = raw.result.result;
      item.meta = raw.result.meta;
      if (raw.result.grounding_meta) item.grounding_meta = raw.result.grounding_meta;
    }
    if (raw.error != null) item.error = raw.error;
    return item;
  });
}

function envApiKey(): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.LEVANTO_API_KEY;
}

/** Client for the Levanto Sage decision API (v1.1). */
export class LevantoClient {
  private readonly http: Http;
  private readonly reasoning?: Reasoning;

  constructor(options: LevantoClientOptions = {}) {
    const apiKey = options.apiKey ?? envApiKey();
    if (!apiKey) throw new LevantoError('No API key: pass { apiKey } or set LEVANTO_API_KEY.');
    this.reasoning = options.reasoning;
    this.http = new Http({
      apiKey,
      baseUrl: (options.baseUrl ?? 'https://sage.levanto.ai').replace(/\/+$/, ''),
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 3,
      userAgent: `levanto-js/${VERSION}`,
      fetchImpl: options.fetch,
    });
  }

  private pick(opts: CallOpts): Reasoning | null | undefined {
    return opts.reasoning === undefined ? this.reasoning : opts.reasoning;
  }

  /** One question: `POST /decide`, returns the full envelope. */
  decide<Q extends Question>(document: DocumentInput, question: Q, opts?: CallOpts): Promise<DecideEnvelope<Q['kind']>>;
  /**
   * Several questions about one document: one `POST /decide/batch` call, one item per question, in order.
   * The array also has `meta`: usage and latency for the whole call (not reported per item).
   */
  decide(document: DocumentInput, questions: Question[], opts?: CallOpts): Promise<BatchResult>;
  async decide(
    document: DocumentInput,
    question: Question | Question[],
    opts: CallOpts = {}
  ): Promise<DecideEnvelope | BatchResult> {
    if (Array.isArray(question)) {
      const res = await this.http.post<WireBatchResponse>(
        '/decide/batch',
        batchBody([{ document, questions: question }], this.pick(opts))
      );
      return withMeta(flatten(question, res.results?.[0]?.answers), res);
    }
    return this.http.post<DecideEnvelope>('/decide', singleBody(document, question, this.pick(opts)));
  }

  /** Several documents, each with its own questions, in one `POST /decide/batch` call. The array also has `meta`. */
  async decideGroups(groups: QuestionGroup[], opts: CallOpts = {}): Promise<GroupsResult> {
    const res = await this.http.post<WireBatchResponse>('/decide/batch', batchBody(groups, this.pick(opts)));
    return withMeta(
      groups.map((g, i) => ({ items: flatten(g.questions, res.results?.[i]?.answers) })),
      res
    );
  }

  /** `GET /ready`: true when Sage is serving. */
  ready(): Promise<boolean> {
    return this.http.ready();
  }

  // Shortcuts: one question, returns only its `result`.

  async yesno(document: DocumentInput, instructions: string, opts: GroundedOpts & CallOpts = {}): Promise<YesNoResult> {
    return (await this.decide(document, new YesNo(instructions, opts), opts)).result;
  }

  async choice(
    document: DocumentInput,
    instructions: string,
    options: Array<string | ChoiceOption>,
    opts: GroundedOpts & CallOpts = {}
  ): Promise<ChoiceResult> {
    return (await this.decide(document, new Choice(instructions, options, opts), opts)).result;
  }

  async scale(
    document: DocumentInput,
    instructions: string,
    levels: Array<string | ScaleLevel>,
    opts: GroundedOpts & CallOpts = {}
  ): Promise<ScaleResult> {
    return (await this.decide(document, new Scale(instructions, levels, opts), opts)).result;
  }

  async sort(items: DocumentInput, instructions: string, opts: IdOpts & CallOpts = {}): Promise<SortResult> {
    return (await this.decide(items, new Sort(instructions, opts), opts)).result;
  }

  async tags(document: DocumentInput, tags: Array<string | TagSpec>, opts: TagsOpts & CallOpts = {}): Promise<TagsResult> {
    return (await this.decide(document, new Tags(tags, opts), opts)).result;
  }
}
