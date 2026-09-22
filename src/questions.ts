/**
 * Questions (one class per kind), their sub-objects, grounding, and image helpers.
 *
 * Bare strings are shorthands: `new Choice(i, ['a', 'b'])` (options),
 * `new Scale(i, [five strings])` (levels 0..4 in order), `new Tags(['spam'])` (tag ids).
 */

import type { ImageContent, Kind } from './types';

export type Trigger = 'never' | 'low_confidence' | 'always';

/** Optional web search before deciding. Unset fields use the server defaults. */
export interface Grounding {
  /** Default `low_confidence`. */
  trigger?: Trigger;
  /** 0..1, default 0.80. */
  confidenceFloor?: number;
  /** 1..20, default 10. */
  maxResults?: number;
  /** 1..8000, default 2000. */
  maxContextTokens?: number;
  /** Default true. */
  returnSources?: boolean;
}

export interface ChoiceOption {
  option: string;
  /** When this option applies. */
  description?: string;
}

export type ScaleLevelValue = 0 | 1 | 2 | 3 | 4;

export interface ScaleLevel {
  level: ScaleLevelValue;
  description?: string;
}

/**
 * A tag. Sage reads `name` (`"<id>: <what it is, and is not>"` works best),
 * or `id` when there is no name; you get `id` back.
 */
export interface TagSpec {
  id: string;
  name?: string;
}

export interface IdOpts {
  id?: string;
}

export interface GroundedOpts extends IdOpts {
  grounding?: Grounding;
}

export interface TagsOpts extends GroundedOpts {
  /** The rule for when a tag applies, including what doesn't count. */
  instructions?: string;
}

/** @internal Wire form of a question (grounding excluded). */
export interface WireQuestion {
  id: string;
  kind: Kind;
  instructions?: string;
  options?: ChoiceOption[];
  levels?: ScaleLevel[];
  tags?: TagSpec[];
}

/** @internal Grounding in wire form (snake_case, only set fields). */
export function groundingToWire(g: Grounding): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  if (g.trigger !== undefined) wire.trigger = g.trigger;
  if (g.confidenceFloor !== undefined) wire.confidence_floor = g.confidenceFloor;
  if (g.maxResults !== undefined) wire.max_results = g.maxResults;
  if (g.maxContextTokens !== undefined) wire.max_context_tokens = g.maxContextTokens;
  if (g.returnSources !== undefined) wire.return_sources = g.returnSources;
  return wire;
}

abstract class BaseQuestion<K extends Kind> {
  abstract readonly kind: K;
  id?: string;

  /** @internal */
  protected abstract fields(): Omit<WireQuestion, 'id' | 'kind'>;

  /** @internal The wire `question` object; `defaultId` is used when `id` is unset. */
  toWire(defaultId: string): WireQuestion {
    return { id: this.id ?? defaultId, kind: this.kind, ...this.fields() };
  }
}

/** Yes/No: `answer` is `'yes'`, `'no'`, or `null` when Sage isn't sure. */
export class YesNo extends BaseQuestion<'yesno'> {
  readonly kind = 'yesno' as const;
  grounding?: Grounding;

  constructor(
    readonly instructions: string,
    opts: GroundedOpts = {}
  ) {
    super();
    this.id = opts.id;
    this.grounding = opts.grounding;
  }

  protected fields() {
    return { instructions: this.instructions };
  }
}

/** Pick one of 2-120 options (at most 20 with image content). */
export class Choice extends BaseQuestion<'choice'> {
  readonly kind = 'choice' as const;
  readonly options: ChoiceOption[];
  grounding?: Grounding;

  constructor(
    readonly instructions: string,
    options: Array<string | ChoiceOption>,
    opts: GroundedOpts = {}
  ) {
    super();
    this.options = options.map((o) => (typeof o === 'string' ? { option: o } : o));
    this.id = opts.id;
    this.grounding = opts.grounding;
  }

  protected fields() {
    return { instructions: this.instructions, options: this.options };
  }
}

/** Score against exactly five levels, 0..4. */
export class Scale extends BaseQuestion<'scale'> {
  readonly kind = 'scale' as const;
  readonly levels: ScaleLevel[];
  grounding?: Grounding;

  constructor(
    readonly instructions: string,
    levels: Array<string | ScaleLevel>,
    opts: GroundedOpts = {}
  ) {
    super();
    this.levels = levels.map((l, i) =>
      typeof l === 'string' ? { level: i as ScaleLevelValue, description: l } : l
    );
    this.id = opts.id;
    this.grounding = opts.grounding;
  }

  protected fields() {
    return { instructions: this.instructions, levels: this.levels };
  }
}

/** Rank a list of 2-120 `{ id, content }` items. No grounding, no images. */
export class Sort extends BaseQuestion<'sort'> {
  readonly kind = 'sort' as const;
  readonly grounding?: undefined;

  constructor(
    readonly instructions: string,
    opts: IdOpts = {}
  ) {
    super();
    this.id = opts.id;
  }

  protected fields() {
    return { instructions: this.instructions };
  }
}

/** Decide which of 1-120 tags apply. */
export class Tags extends BaseQuestion<'tags'> {
  readonly kind = 'tags' as const;
  readonly tags: TagSpec[];
  readonly instructions?: string;
  grounding?: Grounding;

  constructor(tags: Array<string | TagSpec>, opts: TagsOpts = {}) {
    super();
    this.tags = tags.map((t) => (typeof t === 'string' ? { id: t } : t));
    this.instructions = opts.instructions;
    this.id = opts.id;
    this.grounding = opts.grounding;
  }

  protected fields() {
    return this.instructions === undefined
      ? { tags: this.tags }
      : { instructions: this.instructions, tags: this.tags };
  }
}

export type Question = YesNo | Choice | Scale | Sort | Tags;

// --- images --------------------------------------------------------------------

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_TYPES)[number];

function sniffImageType(b: Uint8Array): ImageMimeType | undefined {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

function toBase64(bytes: Uint8Array): string {
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Image content from a `data:` URI you already have. */
export function image(media: string, text?: string): ImageContent {
  return text === undefined ? { kind: 'image', media } : { kind: 'image', media, text };
}

/**
 * Image content from raw bytes (e.g. `await readFile('shot.png')`). The type
 * is detected from the bytes unless you pass `mimeType`. PNG, JPEG, or WebP.
 */
export function imageFromBytes(
  bytes: Uint8Array | ArrayBuffer,
  opts: { mimeType?: ImageMimeType; text?: string } = {}
): ImageContent {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const mime = opts.mimeType ?? sniffImageType(data);
  if (!mime || !(IMAGE_TYPES as readonly string[]).includes(mime)) {
    throw new TypeError(`image must be PNG, JPEG, or WebP; got ${mime ?? 'an unknown format'}`);
  }
  return image(`data:${mime};base64,${toBase64(data)}`, opts.text);
}
