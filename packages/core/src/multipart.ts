import { isStandardSchema, type StandardSchemaV1 } from './schema.js';

/**
 * What a multipart parser such as multer hands over for an uploaded file, described structurally so that core does not
 * depend on it: `buffer` with in-memory storage, `path` with disk storage.
 */
export interface MulterFileLike {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer?: Uint8Array | undefined;
  readonly path?: string | undefined;
}

/**
 * Converts an uploaded multer file to a web `File`, so that file schemas (`z.file()`) can check it. A file kept in
 * memory is wrapped as is; a file stored on disk is opened with `fs.openAsBlob()`, without reading it whole. Server
 * only: `node:fs` is loaded when a disk file is converted, never at import time.
 */
export async function multerFileToFile(file: MulterFileLike): Promise<File> {
  const options = { type: file.mimetype };

  if (file.buffer !== undefined) {
    return new File([file.buffer as Uint8Array<ArrayBuffer>], file.originalname, options);
  }

  if (file.path !== undefined) {
    // Resolved at run time so that browser bundles never see a `node:fs` import
    const { openAsBlob } = process.getBuiltinModule('node:fs');

    return new File([await openAsBlob(file.path, options)], file.originalname, options);
  }

  throw new TypeError(`The uploaded file "${file.originalname}" has neither a buffer nor a path`);
}

/** Schemas of the text fields of a multipart body: one object schema, or one schema per field. */
export type MultipartFieldSchemas = StandardSchemaV1 | Readonly<Record<string, StandardSchemaV1>>;

/**
 * Validates the text fields of a multipart body, which a multipart parser always delivers as strings. Each value is
 * checked as is first; when it fails, the value parsed as JSON is tried instead, so `"12.5"` passes a number schema
 * while `"75001"` stays a string for a string schema. Returns the schemas' output, or the issues of the last attempt.
 *
 * With one schema per field, only the declared fields are kept, and issue paths start with the field name. With an
 * object schema, the JSON fallback applies to the top-level fields its issues point to.
 */
export async function validateMultipartFields(
  fields: MultipartFieldSchemas,
  body: Readonly<Record<string, unknown>> | undefined,
): Promise<StandardSchemaV1.Result<Record<string, unknown>>> {
  const values = body ?? {};

  return isStandardSchema(fields) ? validateObject(fields, values) : validateEach(fields, values);
}

async function validateEach(
  fields: Readonly<Record<string, StandardSchemaV1>>,
  values: Readonly<Record<string, unknown>>,
): Promise<StandardSchemaV1.Result<Record<string, unknown>>> {
  const output: Record<string, unknown> = {};
  const issues: StandardSchemaV1.Issue[] = [];

  for (const [name, schema] of Object.entries(fields)) {
    const result = await validateWithFallback(schema, fieldValue(values, name));

    if (result.issues === undefined) {
      if (result.value !== undefined) {
        output[name] = result.value;
      }
    } else {
      issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...(issue.path ?? [])] })));
    }
  }

  return issues.length > 0 ? { issues } : { value: output };
}

async function validateWithFallback(
  schema: StandardSchemaV1,
  value: unknown,
): Promise<StandardSchemaV1.Result<unknown>> {
  const result = await schema['~standard'].validate(value);

  if (result.issues === undefined) {
    return result;
  }

  const parsed = parseJson(value);

  return parsed === NOT_JSON ? result : schema['~standard'].validate(parsed);
}

async function validateObject(
  schema: StandardSchemaV1,
  values: Readonly<Record<string, unknown>>,
): Promise<StandardSchemaV1.Result<Record<string, unknown>>> {
  const result = await schema['~standard'].validate(values);

  if (result.issues === undefined) {
    return result as StandardSchemaV1.Result<Record<string, unknown>>;
  }

  const retried = { ...values };
  let changed = false;

  for (const name of new Set(result.issues.map((issue) => topLevelKey(issue)))) {
    if (name === undefined) {
      continue;
    }

    const parsed = parseJson(fieldValue(values, name));

    if (parsed !== NOT_JSON) {
      retried[name] = parsed;
      changed = true;
    }
  }

  const final = changed ? await schema['~standard'].validate(retried) : result;

  return final as StandardSchemaV1.Result<Record<string, unknown>>;
}

function topLevelKey(issue: StandardSchemaV1.Issue): string | undefined {
  const segment = issue.path?.[0];
  const key = typeof segment === 'object' && segment !== null ? segment.key : segment;

  return typeof key === 'string' ? key : undefined;
}

function fieldValue(values: Readonly<Record<string, unknown>>, name: string): unknown {
  return Object.hasOwn(values, name) ? values[name] : undefined;
}

const NOT_JSON = Symbol('not JSON');

/** Parses a text value, or each text value of a repeated field, as JSON. */
function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return NOT_JSON;
    }
  }

  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
    const items = value.map((item) => parseJson(item));

    return items.every((item) => item === NOT_JSON)
      ? NOT_JSON
      : items.map((item, i) => (item === NOT_JSON ? value[i] : item));
  }

  return NOT_JSON;
}
