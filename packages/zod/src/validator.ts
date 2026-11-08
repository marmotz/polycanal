import type { SchemaValidator, StandardSchemaV1 } from '@polycanal/core';

interface ZodIssueLike {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

type ZodSafeParseResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly error: { readonly issues: readonly ZodIssueLike[] } };

/** The parse methods of a Zod 4 schema, read structurally so that this package does not load Zod at runtime. */
interface ZodSchemaLike {
  safeParse(value: unknown, params?: unknown): ZodSafeParseResult;
  safeParseAsync(value: unknown, params?: unknown): Promise<ZodSafeParseResult>;
}

/** Parse options of Zod (`schema.safeParse(value, params)`), e.g. `{ error: (issue) => message }`. */
export interface ZodParseParams {
  readonly error?: (issue: never) => string | { message: string } | undefined | null;
  readonly reportInput?: boolean;
  readonly jitless?: boolean;
}

function isZodSchema(schema: StandardSchemaV1): schema is StandardSchemaV1 & ZodSchemaLike {
  const candidate = schema as Partial<ZodSchemaLike>;

  return (
    schema['~standard'].vendor === 'zod' &&
    typeof candidate.safeParse === 'function' &&
    typeof candidate.safeParseAsync === 'function'
  );
}

function toResult(result: ZodSafeParseResult): StandardSchemaV1.Result<unknown> {
  return result.success
    ? { value: result.data }
    : { issues: result.error.issues.map(({ message, path }) => ({ message, path: [...path] })) };
}

/**
 * Validator of `createClient()` that parses Zod schemas with `params`, which Standard Schema cannot pass: error
 * messages in another language, for instance. Schemas of other libraries keep their Standard Schema validation.
 *
 * @example
 * createClient(contract, { drivers, validator: zodValidator({ error: frenchMessage }) });
 */
export function zodValidator(params: ZodParseParams): SchemaValidator {
  return (schema, value) => {
    if (!isZodSchema(schema)) {
      return schema['~standard'].validate(value);
    }

    try {
      return toResult(schema.safeParse(value, params));
    } catch {
      // A schema with async refinements or transforms throws on safeParse()
      return schema.safeParseAsync(value, params).then(toResult);
    }
  };
}
