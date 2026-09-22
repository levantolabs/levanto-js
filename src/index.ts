// Public entry point for the `levanto` package.

export { LevantoClient } from './client';
export type { LevantoClientOptions, CallOpts, QuestionGroup } from './client';
export type { FetchLike } from './http';

export { YesNo, Choice, Scale, Sort, Tags, image, imageFromBytes } from './questions';
export type {
  Question,
  Grounding,
  Trigger,
  ChoiceOption,
  ScaleLevel,
  ScaleLevelValue,
  TagSpec,
  IdOpts,
  GroundedOpts,
  TagsOpts,
  ImageMimeType,
} from './questions';

export type {
  Kind,
  Reasoning,
  DocumentInput,
  Content,
  TextContent,
  ImageContent,
  ListContent,
  ListItem,
  YesNoResult,
  ChoiceProbability,
  ChoiceResult,
  ScaleResult,
  SortResult,
  TagResult,
  TagsResult,
  Result,
  ResultForKind,
  Usage,
  ReasoningMeta,
  Meta,
  Source,
  GroundingMeta,
  DecideEnvelope,
  BatchItem,
  BatchMeta,
  BatchResult,
  GroupResult,
  GroupsResult,
} from './types';

export {
  LevantoError,
  AuthError,
  AllowanceExhaustedError,
  ValidationError,
  ServiceUnavailableError,
  LevantoAPIError,
} from './errors';

export { VERSION } from './version';
