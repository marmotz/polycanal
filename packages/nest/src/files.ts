import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { describeSchema } from '@polycanal/codegen';
import {
  isStandardSchema,
  type JsonSchema,
  type MulterFileLike,
  multerFileToFile,
  type StandardSchemaV1,
  validateMultipartFields,
} from '@polycanal/core';

/** Marks the pipes of this module, so that discovery recognizes them whatever copy of the package created them. */
export const FILES_PIPE = Symbol.for('polycanal.nest.filesPipe');

export interface FilePipeOptions {
  /**
   * Name of the multipart field the file comes from, as given to `FileInterceptor()`, which discovery cannot read.
   * Needed to describe the file field when `@UploadedFile()` has no key and `@Endpoint({ input })` does not declare it.
   */
  readonly field?: string;
}

/** Schemas of the uploaded files, one per multipart field (`FileFieldsInterceptor()`). */
export type FileFieldSchemas = Readonly<Record<string, StandardSchemaV1>>;

/** Pipe of `@UploadedFile()`: validates the uploaded file and hands the multer file over unchanged. */
export interface FilePipe extends PipeTransform<unknown, Promise<unknown>> {
  readonly [FILES_PIPE]: 'file';
  readonly schema: StandardSchemaV1;
  readonly field: string | undefined;
}

/** Pipe of `@UploadedFiles()`: validates the uploaded files and hands the multer files over unchanged. */
export interface FilesPipe extends PipeTransform<unknown, Promise<unknown>> {
  readonly [FILES_PIPE]: 'files';
  /** With one schema for every file (`FilesInterceptor()`, or an object schema for `FileFieldsInterceptor()`). */
  readonly schema: StandardSchemaV1 | undefined;
  /** With one schema per field (`FileFieldsInterceptor()`). */
  readonly fields: FileFieldSchemas | undefined;
  readonly field: string | undefined;
}

/** Pipe of `@Body()` on a multipart route: validates the text fields, parsing them as JSON when needed. */
export interface MultipartBodyPipe extends PipeTransform<unknown, Promise<Record<string, unknown>>> {
  readonly schema: StandardSchemaV1;
}

/**
 * Validates the file of `@UploadedFile()` with a file schema (`z.file()`): the multer file is converted to a web `File`
 * (in memory or opened from disk), checked, and handed over unchanged to the handler. Fails with a `400` carrying the
 * issues. Discovery reads the schema from the pipe.
 *
 * @example
 * ```ts
 * @Post('avatar')
 * @UseInterceptors(FileInterceptor('avatar'))
 * upload(@UploadedFile(filePipe(z.file().mime(['image/png']), { field: 'avatar' })) avatar: Express.Multer.File) {}
 * ```
 */
export function filePipe(schema: StandardSchemaV1, options: FilePipeOptions = {}): FilePipe {
  return {
    [FILES_PIPE]: 'file',
    schema,
    field: options.field,
    async transform(value) {
      const file = isMulterFile(value) ? await multerFileToFile(value) : value;

      await check(schema, file, 'Invalid uploaded file');

      return value;
    },
  };
}

/**
 * Validates the files of `@UploadedFiles()`: with one schema (`z.array(z.file())` for `FilesInterceptor()`, an object
 * schema for `FileFieldsInterceptor()`), or with one schema per field. A field whose schema is not an array receives
 * its single file. The multer files are handed over unchanged; failures answer `400` with the issues.
 *
 * @example
 * ```ts
 * @Post('listing')
 * @UseInterceptors(FileFieldsInterceptor([{ name: 'cover', maxCount: 1 }, { name: 'photos' }]))
 * create(@UploadedFiles(filesPipe({ cover: z.file(), photos: z.array(z.file()) })) files: unknown) {}
 * ```
 */
export function filesPipe(
  schemaOrFields: StandardSchemaV1 | FileFieldSchemas,
  options: FilePipeOptions = {},
): FilesPipe {
  const schema = isStandardSchema(schemaOrFields) ? schemaOrFields : undefined;
  const fields = isStandardSchema(schemaOrFields) ? undefined : schemaOrFields;
  const lists = new Map<string, boolean>();
  const isList = (name: string, field: StandardSchemaV1) => {
    let list = lists.get(name);

    if (list === undefined) {
      list = describesArray(field);
      lists.set(name, list);
    }

    return list;
  };

  return {
    [FILES_PIPE]: 'files',
    schema,
    fields,
    field: options.field,
    async transform(value) {
      if (schema !== undefined) {
        await check(schema, await toFiles(value), 'Invalid uploaded files');

        return value;
      }

      const uploaded = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
      const issues: StandardSchemaV1.Issue[] = [];

      for (const [name, field] of Object.entries(fields ?? {})) {
        const files = (await toFiles(Object.hasOwn(uploaded, name) ? uploaded[name] : undefined)) as unknown;
        const list = Array.isArray(files) ? files : files === undefined ? [] : [files];
        const result = await field['~standard'].validate(isList(name, field) ? list : list[0]);

        if (result.issues !== undefined) {
          issues.push(...result.issues.map((issue) => ({ ...issue, path: [name, ...(issue.path ?? [])] })));
        }
      }

      if (issues.length > 0) {
        throw invalid('Invalid uploaded files', issues);
      }

      return value;
    },
  };
}

/**
 * Validates the text fields of a multipart `@Body()`, which multer always delivers as strings: each value is checked as
 * is, then parsed as JSON when that fails (`"12.5"` passes `z.number()`, `"75001"` stays a string for `z.string()`).
 * Returns the schema's output; failures answer `400` with the issues.
 */
export function multipartBodyPipe(schema: StandardSchemaV1): MultipartBodyPipe {
  return {
    schema,
    async transform(value) {
      const body = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
      const result = await validateMultipartFields(schema, body);

      if (result.issues !== undefined) {
        throw invalid('Invalid multipart body', result.issues);
      }

      return result.value;
    },
  };
}

async function check(schema: StandardSchemaV1, value: unknown, message: string): Promise<void> {
  const result = await schema['~standard'].validate(value);

  if (result.issues !== undefined) {
    throw invalid(message, result.issues);
  }
}

function invalid(message: string, issues: readonly StandardSchemaV1.Issue[]): BadRequestException {
  return new BadRequestException({ message, issues });
}

/** Converts the multer files of a value (one file, an array, or an object of arrays) to web `File`s. */
async function toFiles(value: unknown): Promise<unknown> {
  if (isMulterFile(value)) {
    return multerFileToFile(value);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map(toFiles));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      await Promise.all(Object.entries(value).map(async ([name, item]) => [name, await toFiles(item)] as const)),
    );
  }

  return value;
}

function isMulterFile(value: unknown): value is MulterFileLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { originalname?: unknown }).originalname === 'string' &&
    typeof (value as { mimetype?: unknown }).mimetype === 'string' &&
    ('buffer' in value || 'path' in value)
  );
}

/** Whether a schema expects a list, read from its JSON Schema (an array, possibly nullable). */
function describesArray(schema: StandardSchemaV1): boolean {
  try {
    return isArrayJson(describeSchema(schema, 'input', 'filesPipe()'));
  } catch {
    return true;
  }
}

function isArrayJson(json: JsonSchema): boolean {
  if (typeof json !== 'object') {
    return false;
  }

  const type = json.type;

  if (type === 'array' || (Array.isArray(type) && type.includes('array'))) {
    return true;
  }

  const variants = [...(Array.isArray(json.anyOf) ? json.anyOf : []), ...(Array.isArray(json.oneOf) ? json.oneOf : [])];

  return variants.some((variant) => isArrayJson(variant as JsonSchema));
}
