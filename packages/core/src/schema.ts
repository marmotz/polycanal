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
