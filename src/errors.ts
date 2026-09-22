/** Base class for every SDK error. Also thrown for network failures and timeouts (`status` undefined). */
export class LevantoError extends Error {
  /** HTTP status, when the error came from a response. */
  readonly status?: number;
  /** The server's `detail` message, when there is one. */
  readonly detail?: string;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401: the API key is missing or invalid. */
export class AuthError extends LevantoError {}

/** 402: the key is valid, but this period's decision allowance is used up. */
export class AllowanceExhaustedError extends AuthError {}

/** 400/422: the request was rejected (schema, limits, or an unsupported combination). */
export class ValidationError extends LevantoError {}

/** 503 after retries: Sage is loading or temporarily unavailable. */
export class ServiceUnavailableError extends LevantoError {}

/** Any other non-2xx response. */
export class LevantoAPIError extends LevantoError {}

export function errorForStatus(status: number, detail: string): LevantoError {
  const message = `HTTP ${status}${detail ? `: ${detail}` : ''}`;
  const Cls =
    status === 400 || status === 422
      ? ValidationError
      : status === 401
        ? AuthError
        : status === 402
          ? AllowanceExhaustedError
          : status === 503
            ? ServiceUnavailableError
            : LevantoAPIError;
  return new Cls(message, status, detail || undefined);
}
