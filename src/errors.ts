/**
 * Error hierarchy for the Levanto SDK.
 *
 * Every error carries the HTTP `status` (when it originated from a response)
 * and the server-provided `detail` string, so callers can branch on type and
 * still surface the raw message.
 */
export class LevantoError extends Error {
  /** HTTP status code, when the error came from an API response. */
  readonly status?: number;
  /** The `detail` string returned by the server, when present. */
  readonly detail?: string;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'LevantoError';
    this.status = status;
    this.detail = detail;
    // Restore the prototype chain (required when targeting ES5/ES2015 classes
    // that extend built-ins). Harmless on modern targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Missing/invalid API key (401) or balance too low (402). */
export class AuthError extends LevantoError {
  constructor(message: string, status?: number, detail?: string) {
    super(message, status, detail);
    this.name = 'AuthError';
  }
}

/** The request failed server-side validation (400/422). */
export class ValidationError extends LevantoError {
  constructor(message: string, status?: number, detail?: string) {
    super(message, status, detail);
    this.name = 'ValidationError';
  }
}

/** The model/endpoint is unavailable, e.g. still loading (503). */
export class ServiceUnavailableError extends LevantoError {
  constructor(message: string, status?: number, detail?: string) {
    super(message, status, detail);
    this.name = 'ServiceUnavailableError';
  }
}

/** Any other non-2xx response. */
export class LevantoAPIError extends LevantoError {
  constructor(message: string, status?: number, detail?: string) {
    super(message, status, detail);
    this.name = 'LevantoAPIError';
  }
}

/** Map an HTTP status + server detail to the appropriate typed error. */
export function errorForStatus(status: number, detail: string): LevantoError {
  const message = detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
  if (status === 401 || status === 402) return new AuthError(message, status, detail);
  if (status === 400 || status === 422) return new ValidationError(message, status, detail);
  if (status === 503) return new ServiceUnavailableError(message, status, detail);
  return new LevantoAPIError(message, status, detail);
}
