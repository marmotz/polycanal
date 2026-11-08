import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import type { StandardSchemaV1 } from './schema.js';

/** A JSON Schema document (draft 2020-12). */
export type JsonSchema = boolean | { readonly [keyword: string]: unknown };

/**
 * Marker of a value that must be absent (no response body, `z.void()`), which JSON Schema cannot express. Validation
 * drivers generate their "void" schema for it.
 */
export const VOID_KEYWORD = 'x-polycanal-void';

/** Import needed by generated code. */
export interface CodeImport {
  readonly from: string;
  readonly names: readonly string[];
}

/** A generated TypeScript expression and the imports it relies on. */
export interface GeneratedCode {
  readonly code: string;
  readonly imports: readonly CodeImport[];
}

export interface SchemaGenerationContext {
  /** Identifier of the generated schema a `$ref` points to. */
  resolveRef(ref: string): string;
  /** Whether a `$ref` points to a schema declared later or part of a cycle, which needs a lazy reference. */
  isLazyRef(ref: string): boolean;
}

/**
 * Validation driver (spec §5). Runtime validation goes through Standard Schema, so a driver only covers what cannot be
 * abstracted: generating the source code of schemas for its library, and optionally converting its schemas to JSON
 * Schema when the library does not implement Standard JSON Schema.
 */
export interface ValidationDriver {
  readonly name: string;
  /** Generates the source code of a schema from a JSON Schema. */
  generate(schema: JsonSchema, context: SchemaGenerationContext): GeneratedCode;
  /** Converts a schema of this library to JSON Schema. Default: Standard JSON Schema. */
  toJsonSchema?(schema: StandardSchemaV1, io: 'input' | 'output'): JsonSchema | undefined;
}

/**
 * Converts a runtime schema to JSON Schema through Standard JSON Schema. `io` picks the type before (`input`) or after
 * (`output`) transforms and defaults. Returns `undefined` when the schema cannot be converted. A schema rejecting
 * everything but `undefined` (no body) is converted to the void marker.
 */
export function toJsonSchema(schema: StandardSchemaV1, io: 'input' | 'output'): JsonSchema | undefined {
  const converter = (schema['~standard'] as Partial<StandardJSONSchemaV1.Props>).jsonSchema;

  if (converter !== undefined) {
    try {
      const { $schema: _, ...document } = converter[io]({ target: 'draft-2020-12' });

      return document;
    } catch {
      // Unrepresentable types (void, undefined...) are handled below
    }
  }

  return acceptsOnlyUndefined(schema) ? { [VOID_KEYWORD]: true } : undefined;
}

function acceptsOnlyUndefined(schema: StandardSchemaV1): boolean {
  const accepts = (value: unknown) => {
    const result = schema['~standard'].validate(value);

    return !(result instanceof Promise) && result.issues === undefined;
  };

  return accepts(undefined) && !accepts(null) && !accepts('') && !accepts(0) && !accepts({});
}
