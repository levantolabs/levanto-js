/**
 * Question constructors, one distinct class per decision kind. They form a
 * discriminated union (`Question`) keyed on `kind`, and normalize the
 * bare-string shorthands for options/levels/tags at construction time.
 */

/** When grounding (web search) should fire for a decision. */
export type Trigger = 'never' | 'low_confidence' | 'always';

/**
 * Grounding knobs, attached to a question for ergonomics and lifted to the
 * top level of the request at serialization time. `confidenceFloor` maps to
 * the wire field `confidence_floor`. Any extra keys pass through unchanged so
 * the SDK stays forward-compatible with knobs the server adds later.
 *
 * When a field is omitted the server applies its defaults
 * (`trigger = 'low_confidence'`, `confidenceFloor = 0.80`).
 */
export interface Grounding {
  trigger?: Trigger;
  confidenceFloor?: number;
  [key: string]: unknown;
}

/** A single choice option. A bare string is treated as `{ option }`. */
export interface ChoiceOption {
  option: string;
  description?: string;
}

export type ScaleLevelValue = 0 | 1 | 2 | 3 | 4;

/**
 * One rung of a 0..4 scale. A list of 5 bare strings maps to levels 0..4 by
 * index. `description` is optional (the server accepts a level without one).
 */
export interface ScaleLevel {
  level: ScaleLevelValue;
  description?: string;
}

/**
 * A tag to score. When `threshold` (0..1) is set, the result carries an
 * `applies` flag. `name` is an optional human-readable label. A bare string is
 * treated as `{ id }`.
 */
export interface TagSpec {
  id: string;
  name?: string;
  threshold?: number;
}

/** Options bag for kinds that support grounding. */
export interface GroundedOpts {
  id?: string;
  grounding?: Grounding;
}

/** Options bag for `tags`: grounding plus an optional overall instruction. */
export interface TagsOpts extends GroundedOpts {
  instructions?: string;
}

/** Options bag for kinds that do not support grounding (i.e. `sort`). */
export interface IdOpts {
  id?: string;
}

function normalizeOptions(options: Array<string | ChoiceOption>): ChoiceOption[] {
  return options.map((o) => (typeof o === 'string' ? { option: o } : o));
}

function normalizeLevels(levels: Array<string | ScaleLevel>): ScaleLevel[] {
  return levels.map((l, i) =>
    typeof l === 'string' ? { level: i as ScaleLevelValue, description: l } : l
  );
}

function normalizeTags(tags: Array<string | TagSpec>): TagSpec[] {
  return tags.map((t) => (typeof t === 'string' ? { id: t } : t));
}

/** Yes/no decision. */
export class YesNo {
  readonly kind = 'yesno' as const;
  readonly instructions: string;
  id?: string;
  grounding?: Grounding;

  constructor(instructions: string, opts: GroundedOpts = {}) {
    this.instructions = instructions;
    this.id = opts.id;
    this.grounding = opts.grounding;
  }
}

/** Pick one of several options. */
export class Choice {
  readonly kind = 'choice' as const;
  readonly instructions: string;
  readonly options: ChoiceOption[];
  id?: string;
  grounding?: Grounding;

  constructor(
    instructions: string,
    options: Array<string | ChoiceOption>,
    opts: GroundedOpts = {}
  ) {
    this.instructions = instructions;
    this.options = normalizeOptions(options);
    this.id = opts.id;
    this.grounding = opts.grounding;
  }
}

/** Score against a 5-rung (0..4) scale. */
export class Scale {
  readonly kind = 'scale' as const;
  readonly instructions: string;
  readonly levels: ScaleLevel[];
  id?: string;
  grounding?: Grounding;

  constructor(
    instructions: string,
    levels: Array<string | ScaleLevel>,
    opts: GroundedOpts = {}
  ) {
    this.instructions = instructions;
    this.levels = normalizeLevels(levels);
    this.id = opts.id;
    this.grounding = opts.grounding;
  }
}

/** Order a list of items. No grounding (the server rejects extras). */
export class Sort {
  readonly kind = 'sort' as const;
  readonly instructions: string;
  id?: string;

  constructor(instructions: string, opts: IdOpts = {}) {
    this.instructions = instructions;
    this.id = opts.id;
  }
}

/** Score a set of tags. `instructions` is optional. */
export class Tags {
  readonly kind = 'tags' as const;
  readonly tags: TagSpec[];
  readonly instructions?: string;
  id?: string;
  grounding?: Grounding;

  constructor(tags: Array<string | TagSpec>, opts: TagsOpts = {}) {
    this.tags = normalizeTags(tags);
    this.instructions = opts.instructions;
    this.id = opts.id;
    this.grounding = opts.grounding;
  }
}

/** The discriminated union of every question type, keyed on `kind`. */
export type Question = YesNo | Choice | Scale | Sort | Tags;
