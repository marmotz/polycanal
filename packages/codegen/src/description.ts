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

/**
 * Keyword marking a schema the generated contract imports instead of generating: the runtime schema itself, exported
 * by a module the front end can import (e.g. a shared package). The other keywords stay a plain JSON Schema of it.
 */
export const IMPORT_KEYWORD = 'x-polycanal-import';

/** Where the generated contract imports a schema from. */
export interface SchemaImport {
  /** Module specifier, as the generated file imports it (e.g. `@my-app/shared`). */
  readonly from: string;
  /** Exported name. */
  readonly name: string;
}

/** `schema` marked to be imported from `ref` by the generated contract. */
export function importedSchema(schema: JsonSchema, ref: SchemaImport): JsonSchema {
  return { ...(typeof schema === 'object' ? schema : {}), [IMPORT_KEYWORD]: { from: ref.from, name: ref.name } };
}

/** The import a schema is marked with, `undefined` when it is generated. */
export function schemaImportOf(schema: JsonSchema): SchemaImport | undefined {
  const ref = typeof schema === 'object' ? schema[IMPORT_KEYWORD] : undefined;

  return typeof ref === 'object' && ref !== null ? (ref as SchemaImport) : undefined;
}
