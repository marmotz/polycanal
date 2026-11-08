import type { StandardSchemaV1 } from '@standard-schema/spec';

export type { StandardSchemaV1 };

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }

  const props = (value as { '~standard'?: unknown })['~standard'];

  return (
    typeof props === 'object' &&
    props !== null &&
    (props as { version?: unknown }).version === 1 &&
    typeof (props as { validate?: unknown }).validate === 'function'
  );
}

/** Flattens an intersection of object types for readable editor tooltips. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Runs a schema on a value. The client validates through Standard Schema by default; a custom validator can pass
 * library options that Standard Schema cannot carry (error messages, locale...).
 */
export type SchemaValidator = (
  schema: StandardSchemaV1,
  value: unknown,
) => StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>;

/** Default validator: the schema's own Standard Schema `validate()`. */
export const standardValidator: SchemaValidator = (schema, value) => schema['~standard'].validate(value);
