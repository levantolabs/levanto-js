// Public entry point for the `levanto` package.

export { LevantoClient } from './client';
export type { LevantoClientOptions, QuestionGroup } from './client';
export type { FetchLike } from './http';

export { YesNo, Choice, Scale, Sort, Tags } from './questions';
export type {
  Question,
  Grounding,
  Trigger,
  ChoiceOption,
  ScaleLevel,
  ScaleLevelValue,
  TagSpec,
  GroundedOpts,
  IdOpts,
} from './questions';

export type {
  Kind,
  DocumentInput,
  Content,
  TextContent,
  ListContent,
  ListItem,
  Meta,
  GroundingMeta,
  YesNoResult,
  ChoiceProbability,
  ChoiceResult,
  ScaleResult,
  SortResult,
  TagResult,
  TagsResult,
  Result,
  ResultForKind,
  DecideEnvelope,
  BatchItem,
  GroupResult,
} from './types';

export {
  LevantoError,
  AuthError,
  ValidationError,
  ServiceUnavailableError,
  LevantoAPIError,
} from './errors';

export { VERSION } from './version';
