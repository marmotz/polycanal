import type { StandardSchemaV1 } from './schema.js';

/**
 * Thrown when a contract is malformed (invalid field descriptor, unsupported source, wrong binding family...).
 * These are programming errors, raised as soon as the contract is defined.
 */
export class ContractDefinitionError extends Error {
  /** Location of the faulty element in the contract, e.g. `['households', 'list']`. */
  readonly path: readonly string[];
  /** Message without the location prefix. */
  readonly reason: string;

  constructor(reason: string, path: readonly string[] = []) {
    super(path.length > 0 ? `${path.join('.')}: ${reason}` : reason);
    this.name = 'ContractDefinitionError';
    this.path = path;
    this.reason = reason;
  }

  /** Returns a copy of this error located under `prefix`. */
  withPrefix(prefix: readonly string[]): ContractDefinitionError {
    return new ContractDefinitionError(this.reason, [...prefix, ...this.path]);
  }
}

/**
 * Kind of a call failure:
 * - `input`: the call argument did not match the input schema, nothing was sent;
 * - `output`: the response did not match the output schema;
 * - `server`: the server answered with an error (`key` and `data` describe it);
 * - `transport`: the call could not be carried (network failure, abort, undecodable body, missing driver).
 */
export type PolycanalErrorKind = 'input' | 'output' | 'server' | 'transport';

export interface PolycanalErrorDetails<TData = unknown> {
  readonly kind: PolycanalErrorKind;
  /** Id of the operation, e.g. `'households.list'`. */
  readonly operation: string;
  readonly driver: string;
  /** Error key reported by the driver (HTTP status for REST), for `server` errors. */
  readonly key?: string | undefined;
  /** Error body, validated against the matching `errors` schema when the action declares one. */
  readonly data?: TData | undefined;
  /** Validation issues (`input`, `output`, or a `server` error body not matching its schema). */
  readonly issues?: readonly StandardSchemaV1.Issue[] | undefined;
  /** Native response, when there is one. */
  readonly response?: unknown;
  readonly cause?: unknown;
}

/** Error thrown by client calls, with structured data for programmatic handling (spec §10). */
export class PolycanalError<TData = unknown> extends Error {
  readonly kind: PolycanalErrorKind;
  readonly operation: string;
  readonly driver: string;
  readonly key: string | undefined;
  readonly data: TData | undefined;
  readonly issues: readonly StandardSchemaV1.Issue[] | undefined;
  readonly response: unknown;

  constructor(message: string, details: PolycanalErrorDetails<TData>) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'PolycanalError';
    this.kind = details.kind;
    this.operation = details.operation;
    this.driver = details.driver;
    this.key = details.key;
    this.data = details.data;
    this.issues = details.issues;
    this.response = details.response;
  }
}

/** Whether `error` is a `PolycanalError`, optionally of a given kind and error key. */
export function isPolycanalError(
  error: unknown,
  filter: { readonly kind?: PolycanalErrorKind; readonly key?: string | number } = {},
): error is PolycanalError {
  return (
    error instanceof PolycanalError &&
    (filter.kind === undefined || error.kind === filter.kind) &&
    (filter.key === undefined || error.key === String(filter.key))
  );
}
