import type { StandardSchemaV1 } from './schema.js';

/**
 * Validates what a server is about to answer against a response schema, as the client will read it: the value goes
 * through JSON first, so a `Date` is checked as the string it becomes. Server adapters use it to check responses before
 * they leave. The value itself is left untouched.
 */
export async function validateJsonResponse(
  schema: StandardSchemaV1,
  value: unknown,
): Promise<StandardSchemaV1.Result<unknown>> {
  const wire = value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);

  return schema['~standard'].validate(wire);
}
