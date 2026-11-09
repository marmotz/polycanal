import { describeSchema } from '@polycanal/codegen';
import {
  type FieldDescriptor,
  isStandardSchema,
  type JsonSchema,
  type MulterFileLike,
  multerFileToFile,
  type StandardSchemaV1,
  validateMultipartFields,
} from '@polycanal/core';
import type { EndpointInput } from './endpoint.js';

/** Name multer gives to its middlewares (`multer@2`, `lib/make-middleware.js`), the only trace it leaves on a route. */
const MULTER_MIDDLEWARE = 'multerMiddleware';

/** Whether a route handler is a multer middleware (`upload.single()`, `upload.array()`, `upload.fields()`...). */
export function isMulterMiddleware(handler: unknown): boolean {
  return typeof handler === 'function' && handler.name === MULTER_MIDDLEWARE;
}

/** How a JSON Schema describes uploaded files: one file, a list of files, or neither. */
export function fileKind(json: JsonSchema | undefined): 'file' | 'list' | undefined {
  if (typeof json !== 'object') {
    return undefined;
  }

  if (isFileJson(json)) {
    return 'file';
  }

  const type = json.type;

  if ((type === 'array' || (Array.isArray(type) && type.includes('array'))) && isFileJson(json.items)) {
    return 'list';
  }

  const variants = [...(Array.isArray(json.anyOf) ? json.anyOf : []), ...(Array.isArray(json.oneOf) ? json.oneOf : [])];

  for (const variant of variants) {
    const kind = fileKind(variant as JsonSchema);

    if (kind !== undefined) {
      return kind;
    }
  }

  return undefined;
}

function isFileJson(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) {
    return false;
  }

  const { type, format } = json as { type?: unknown; format?: unknown };

  return format === 'binary' && (type === 'string' || (Array.isArray(type) && type.includes('string')));
}

/** What `endpoint()` checks on a multipart route. */
interface MultipartPlan {
  /** Object schema covering the whole input, files included. */
  readonly schema: StandardSchemaV1 | undefined;
  /** File fields by wire name. */
  readonly files: ReadonlyMap<string, FileField>;
  /** Field map: schemas of the body fields by wire name, files excluded. Their source is resolved per request. */
  readonly fields: readonly MultipartField[];
}

interface FileField {
  /** Schema of the field, `undefined` when an object schema covers the whole input. */
  readonly schema: StandardSchemaV1 | undefined;
  /** Whether the field expects a list of files. */
  readonly list: boolean;
}

interface MultipartField {
  readonly wireName: string;
  readonly schema: StandardSchemaV1;
  /** Declared source; without one, the field is in the path when the route has a parameter of that name. */
  readonly source: string | undefined;
}

/** What `endpoint()` checks for an input, `undefined` when the input declares no file field. */
export function multipartPlan(input: EndpointInput | undefined): MultipartPlan | undefined {
  if (input === undefined) {
    return undefined;
  }

  const files = new Map<string, FileField>();

  if (isStandardSchema(input)) {
    const json = describe(input);
    const properties =
      typeof json === 'object' ? (json.properties as Record<string, JsonSchema> | undefined) : undefined;

    for (const [name, property] of Object.entries(properties ?? {})) {
      const kind = fileKind(property);

      if (kind !== undefined) {
        files.set(name, { schema: undefined, list: kind === 'list' });
      }
    }

    return files.size === 0 ? undefined : { schema: input, files, fields: [] };
  }

  const fields: MultipartField[] = [];

  for (const [name, field] of Object.entries(input)) {
    const descriptor: FieldDescriptor = isStandardSchema(field) ? { schema: field } : field;
    const wireName = descriptor.alias ?? name;

    if (descriptor.root || (descriptor.source !== undefined && descriptor.source !== 'body')) {
      continue;
    }

    const kind = fileKind(describe(descriptor.schema));

    if (kind === undefined) {
      fields.push({ wireName, schema: descriptor.schema, source: descriptor.source });
    } else {
      files.set(wireName, { schema: descriptor.schema, list: kind === 'list' });
    }
  }

  return files.size === 0 ? undefined : { schema: undefined, files, fields };
}

function describe(schema: StandardSchemaV1): JsonSchema | undefined {
  try {
    return describeSchema(schema, 'input', 'endpoint() input');
  } catch {
    return undefined;
  }
}

/** The parts of an Express request the multipart validation reads and updates. */
export interface MultipartRequestLike {
  body?: unknown;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly file?: unknown;
  readonly files?: unknown;
}

/** Outcome of the multipart validation: the request body to use, or the `400` body. */
export type MultipartCheck =
  | { readonly body: Record<string, unknown> }
  | { readonly error: { readonly message: string; readonly issues: readonly StandardSchemaV1.Issue[] } };

/**
 * Validates a multipart request against its plan: the uploaded files (`req.file`, `req.files` as an array or an object
 * of arrays) converted to web `File`s, and the text fields of `req.body`, parsed as JSON when needed. Returns the new
 * body (text fields only, as the schemas output them), or the `400` body with every issue.
 */
export async function checkMultipart(plan: MultipartPlan, request: MultipartRequestLike): Promise<MultipartCheck> {
  const uploaded = await uploadedFiles(request);
  const body =
    typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {};
  const params = request.params ?? {};
  const files: Record<string, unknown> = {};

  for (const [name, field] of plan.files) {
    const received = uploaded.get(name) ?? [];
    files[name] = field.list ? received : received[0];
  }

  if (plan.schema !== undefined) {
    const declared = Object.keys(params);
    const result = await validateMultipartFields(plan.schema, { ...body, ...params, ...files });

    if (result.issues !== undefined) {
      return { error: invalid(plan, result.issues) };
    }

    const output = { ...result.value };

    for (const name of [...declared, ...plan.files.keys()]) {
      delete output[name];
    }

    return { body: output };
  }

  const issues: StandardSchemaV1.Issue[] = [];

  for (const [name, field] of plan.files) {
    const result = await (field.schema as StandardSchemaV1)['~standard'].validate(files[name]);

    if (result.issues !== undefined) {
      issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...(issue.path ?? [])] })));
    }
  }

  const texts = Object.fromEntries(
    plan.fields
      .filter((field) => field.source === 'body' || !Object.hasOwn(params, field.wireName))
      .map((field) => [field.wireName, field.schema]),
  );
  const result = await validateMultipartFields(texts, body);

  if (result.issues !== undefined) {
    issues.push(...result.issues);
  }

  if (issues.length > 0 || result.issues !== undefined) {
    return { error: invalid(plan, issues) };
  }

  return { body: result.value };
}

function invalid(
  plan: MultipartPlan,
  issues: readonly StandardSchemaV1.Issue[],
): { message: string; issues: readonly StandardSchemaV1.Issue[] } {
  const onFiles = issues.some((issue) => {
    const segment = issue.path?.[0];
    const key = typeof segment === 'object' && segment !== null ? segment.key : segment;

    return typeof key === 'string' && plan.files.has(key);
  });

  return { message: onFiles ? 'Invalid uploaded files' : 'Invalid multipart body', issues };
}

/** Uploaded multer files grouped by field name, converted to web `File`s. */
async function uploadedFiles(request: MultipartRequestLike): Promise<Map<string, File[]>> {
  const found: MulterFile[] = [];
  const collect = (value: unknown) => {
    if (isMulterFile(value)) {
      found.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(collect);
    }
  };

  collect(request.file);
  collect(request.files);

  const grouped = new Map<string, File[]>();

  for (const file of found) {
    const converted = await multerFileToFile(file);
    grouped.set(file.fieldname, [...(grouped.get(file.fieldname) ?? []), converted]);
  }

  return grouped;
}

interface MulterFile extends MulterFileLike {
  readonly fieldname: string;
}

function isMulterFile(value: unknown): value is MulterFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { fieldname?: unknown }).fieldname === 'string' &&
    typeof (value as { originalname?: unknown }).originalname === 'string' &&
    typeof (value as { mimetype?: unknown }).mimetype === 'string' &&
    ('buffer' in value || 'path' in value)
  );
}
