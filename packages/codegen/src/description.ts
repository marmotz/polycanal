import type { JsonSchema, OperationMeta, TransportBinding } from '@polycanal/core';

/**
 * Serializable description of a contract, with JSON Schemas instead of runtime schemas. It is what server adapters
 * (discovery, decorators) and importers (OpenAPI) produce, and what the generator turns into TypeScript.
 *
 * `$ref`s point to `schemas` with `#/schemas/<name>`.
 */
export interface ContractDescription {
  readonly operations: readonly OperationDescription[];
  /** Named schemas, generated as exported constants. */
  readonly schemas?: Readonly<Record<string, JsonSchema>>;
}

export type OperationDescription = ActionDescription | EventDescription;

export interface ActionDescription {
  readonly family: 'action';
  /** Location in the contract tree, e.g. `['households', 'list']`. */
  readonly path: readonly string[];
  readonly binding: TransportBinding;
  readonly input?: InputDescription;
  readonly output: JsonSchema;
  /** Error body schemas, keyed by error key (HTTP status for REST). */
  readonly errors?: Readonly<Record<string, JsonSchema>>;
  readonly meta?: OperationMeta;
}

export interface EventDescription {
  readonly family: 'event';
  readonly path: readonly string[];
  readonly binding: TransportBinding;
  readonly send?: JsonSchema;
  readonly receive?: JsonSchema;
  readonly meta?: OperationMeta;
}

/** Input as `input()` fields, or as a single object schema. */
export type InputDescription =
  | { readonly kind: 'fields'; readonly fields: readonly FieldDescription[] }
  | { readonly kind: 'schema'; readonly schema: JsonSchema };

export interface FieldDescription {
  /** Name in the call. */
  readonly name: string;
  readonly schema: JsonSchema;
  /** Whether the caller must provide it. Fields with a default value are never required. */
  readonly required: boolean;
  readonly source?: string;
  /** Name on the wire, when it differs from `name`. */
  readonly alias?: string;
  readonly root?: boolean;
}

/** Dotted id of an operation description. */
export function operationId(operation: OperationDescription): string {
  return operation.path.join('.');
}

export const SCHEMA_REF_PREFIX = '#/schemas/';
