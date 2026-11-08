import type { ActionDescription, ContractDescription, FieldDescription, InputDescription } from '@polycanal/codegen';
import { SCHEMA_REF_PREFIX } from '@polycanal/codegen';
import { type JsonSchema, type OperationMeta, VOID_KEYWORD } from '@polycanal/core';
import { type HttpMethod, rest } from '@polycanal/rest';

type Json = { readonly [key: string]: unknown };

/** Subset of an OpenAPI 3.0 / 3.1 document read by the importer. */
export interface OpenApiDocument {
  readonly openapi: string;
  readonly paths?: Readonly<Record<string, Json>>;
  readonly components?: Json;
}

export interface OperationInfo {
  readonly method: HttpMethod;
  /** OpenAPI path, e.g. `/users/{id}`. */
  readonly path: string;
  readonly operationId: string | undefined;
  readonly tags: readonly string[];
}

export interface ImportOptions {
  /**
   * Location of an operation in the contract tree. Default: `[camelCase(first tag), camelCase(operationId)]`, the
   * operation name falling back to the method and the path.
   */
  readonly naming?: (operation: OperationInfo) => readonly string[];
}

export interface ImportResult {
  readonly description: ContractDescription;
  /** Operations or parts skipped because they cannot be described (cookies, non-JSON bodies...). */
  readonly warnings: readonly string[];
}

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IGNORED_METHODS = ['head', 'options', 'trace'];

/** Converts an OpenAPI 3 document (JSON) into a contract description, to generate a typed contract from it. */
export function importOpenApi(document: OpenApiDocument, options: ImportOptions = {}): ImportResult {
  if (typeof document.openapi !== 'string' || !document.openapi.startsWith('3.')) {
    throw new TypeError(`importOpenApi: only OpenAPI 3 documents are supported (got "${String(document.openapi)}")`);
  }

  const warnings: string[] = [];
  const resolver = new Resolver(document);
  const naming = options.naming ?? defaultNaming;
  const operations: ActionDescription[] = [];

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (IGNORED_METHODS.includes(method)) {
        warnings.push(`${method.toUpperCase()} ${path}: method not supported, skipped`);
      }
    }

    for (const method of METHODS) {
      const operation = item[method.toLowerCase()] as Json | undefined;

      if (operation === undefined) {
        continue;
      }

      const info: OperationInfo = {
        method,
        path,
        operationId: typeof operation.operationId === 'string' ? operation.operationId : undefined,
        tags: Array.isArray(operation.tags) ? (operation.tags as string[]) : [],
      };

      try {
        operations.push(importOperation(info, item, operation, naming(info), resolver, warnings));
      } catch (error) {
        if (!(error instanceof SkipOperation)) {
          throw error;
        }

        warnings.push(`${method} ${path}: ${error.message}, skipped`);
      }
    }
  }

  const schemas = Object.fromEntries(
    Object.entries((document.components?.schemas ?? {}) as Record<string, unknown>).map(([name, schema]) => [
      name,
      convertSchema(schema),
    ]),
  );

  return { description: { operations, schemas }, warnings };
}

class SkipOperation extends Error {}

function importOperation(
  info: OperationInfo,
  item: Json,
  operation: Json,
  path: readonly string[],
  resolver: Resolver,
  warnings: string[],
): ActionDescription {
  const restPath = info.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new SkipOperation(`path parameter "${name}" is not a valid identifier`);
    }

    return `:${name}`;
  });
  const fields = parameterFields(item, operation, resolver, info, warnings);
  const body = bodyFields(operation, resolver, fields);
  const allFields = [...fields, ...body];
  const input: InputDescription | undefined =
    allFields.length === 0 ? undefined : { kind: 'fields', fields: allFields };
  const { output, errors } = responses(operation, resolver);
  const meta = operationMeta(operation);

  return {
    family: 'action',
    path,
    binding: rest[info.method.toLowerCase() as Lowercase<HttpMethod>](restPath),
    ...(input === undefined ? {} : { input }),
    output,
    ...(Object.keys(errors).length === 0 ? {} : { errors }),
    ...(meta === undefined ? {} : { meta }),
  };
}

function parameterFields(
  item: Json,
  operation: Json,
  resolver: Resolver,
  info: OperationInfo,
  warnings: string[],
): FieldDescription[] {
  const parameters = new Map<string, Json>();

  for (const raw of [...asArray(item.parameters), ...asArray(operation.parameters)]) {
    const parameter = resolver.resolve(raw);
    parameters.set(`${parameter.in}:${parameter.name}`, parameter);
  }

  const used = new Set<string>();
  const fields: FieldDescription[] = [];

  for (const parameter of parameters.values()) {
    const wire = String(parameter.name);
    const location = String(parameter.in);

    if (location === 'cookie') {
      warnings.push(`${info.method} ${info.path}: cookie parameter "${wire}" not supported, ignored`);
      continue;
    }

    const source = location === 'path' ? 'path' : location === 'header' ? 'header' : 'query';
    const name = uniqueName(identifier(wire), used, source);

    fields.push({
      name,
      schema: convertSchema(parameter.schema ?? true),
      required: parameter.required === true || location === 'path',
      source,
      ...(name === wire ? {} : { alias: wire }),
    });
  }

  return fields;
}

function bodyFields(operation: Json, resolver: Resolver, parameters: readonly FieldDescription[]): FieldDescription[] {
  if (operation.requestBody === undefined) {
    return [];
  }

  const body = resolver.resolve(operation.requestBody);
  const schema = jsonContent(body.content);

  if (schema === undefined) {
    throw new SkipOperation('request body has no JSON content');
  }

  const required = body.required === true;
  const resolved = resolver.resolveSchema(schema);
  const properties = resolved.properties as Record<string, unknown> | undefined;
  const taken = new Set(parameters.map((field) => field.name));
  const spreadable =
    properties !== undefined &&
    Object.keys(properties).every((name) => /^[A-Za-z_$][\w$]*$/.test(name) && !taken.has(name)) &&
    resolved.additionalProperties === undefined;

  if (!spreadable) {
    return [
      { name: uniqueName('body', taken, 'body'), schema: convertSchema(schema), required, source: 'body', root: true },
    ];
  }

  const requiredProperties = new Set(asArray(resolved.required) as string[]);

  return Object.entries(properties).map(([name, property]) => ({
    name,
    schema: convertSchema(property),
    required: required && requiredProperties.has(name),
    source: 'body',
  }));
}

function responses(operation: Json, resolver: Resolver): { output: JsonSchema; errors: Record<string, JsonSchema> } {
  const entries = Object.entries((operation.responses ?? {}) as Record<string, unknown>);
  const success = entries.filter(([status]) => /^2\d\d$/.test(status)).sort(([a], [b]) => a.localeCompare(b))[0];
  const errors: Record<string, JsonSchema> = {};

  for (const [status, raw] of entries) {
    if (/^[45]\d\d$/.test(status)) {
      const schema = jsonContent(resolver.resolve(raw).content);

      if (schema !== undefined) {
        errors[status] = convertSchema(schema);
      }
    }
  }

  if (success === undefined) {
    return { output: true, errors };
  }

  const schema = jsonContent(resolver.resolve(success[1]).content);

  return { output: schema === undefined ? { [VOID_KEYWORD]: true } : convertSchema(schema), errors };
}

function jsonContent(content: unknown): unknown {
  if (typeof content !== 'object' || content === null) {
    return undefined;
  }

  const entry = Object.entries(content).find(([media]) => {
    const type = media.split(';')[0]?.trim().toLowerCase() ?? '';

    return type === 'application/json' || type.endsWith('+json');
  });

  return entry === undefined ? undefined : ((entry[1] as Json).schema ?? true);
}

function operationMeta(operation: Json): OperationMeta | undefined {
  const meta: { -readonly [K in keyof OperationMeta]: OperationMeta[K] } = {};

  if (typeof operation.summary === 'string') meta.summary = operation.summary;
  if (typeof operation.description === 'string') meta.description = operation.description;
  if (Array.isArray(operation.tags) && operation.tags.length > 0) meta.tags = operation.tags as string[];
  if (operation.deprecated === true) meta.deprecated = true;

  return Object.keys(meta).length === 0 ? undefined : meta;
}

/** OpenAPI schema object to JSON Schema: component references and OpenAPI 3.0 boolean exclusive bounds. */
export function convertSchema(schema: unknown): JsonSchema {
  if (typeof schema === 'boolean') {
    return schema;
  }

  if (typeof schema !== 'object' || schema === null) {
    return true;
  }

  const converted: Record<string, unknown> = {};

  for (const [keyword, value] of Object.entries(schema)) {
    if (keyword === '$ref' && typeof value === 'string') {
      converted.$ref = value.startsWith('#/components/schemas/')
        ? `${SCHEMA_REF_PREFIX}${value.slice('#/components/schemas/'.length)}`
        : value;
    } else if (keyword === 'properties' || keyword === 'patternProperties' || keyword === '$defs') {
      converted[keyword] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, convertSchema(child)]),
      );
    } else if (['items', 'additionalProperties', 'not'].includes(keyword) && typeof value === 'object') {
      converted[keyword] = convertSchema(value);
    } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(keyword) && Array.isArray(value)) {
      converted[keyword] = value.map(convertSchema);
    } else if ((keyword === 'exclusiveMinimum' || keyword === 'exclusiveMaximum') && typeof value === 'boolean') {
      // OpenAPI 3.0: the bound is in minimum / maximum
      const bound = keyword === 'exclusiveMinimum' ? 'minimum' : 'maximum';

      if (value && typeof (schema as Json)[bound] === 'number') {
        converted[keyword] = (schema as Json)[bound];
      }
    } else if (!['example', 'examples', 'xml', 'externalDocs', 'discriminator'].includes(keyword)) {
      converted[keyword] = value;
    }
  }

  if (converted.exclusiveMinimum !== undefined && (schema as Json).exclusiveMinimum === true) {
    delete converted.minimum;
  }

  if (converted.exclusiveMaximum !== undefined && (schema as Json).exclusiveMaximum === true) {
    delete converted.maximum;
  }

  return converted;
}

class Resolver {
  constructor(private readonly document: OpenApiDocument) {}

  /** Follows `$ref`s to components (parameters, request bodies, responses, schemas). */
  resolve(value: unknown, seen = new Set<string>()): Json {
    if (typeof value !== 'object' || value === null) {
      return {};
    }

    const ref = (value as Json).$ref;

    if (typeof ref !== 'string') {
      return value as Json;
    }

    if (seen.has(ref) || !ref.startsWith('#/')) {
      throw new TypeError(`importOpenApi: cannot resolve "${ref}"`);
    }

    seen.add(ref);
    const target = ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>((node, part) => (node as Json | undefined)?.[part], this.document);

    if (target === undefined) {
      throw new TypeError(`importOpenApi: "${ref}" does not exist`);
    }

    return this.resolve(target, seen);
  }

  resolveSchema(schema: unknown): Json {
    return this.resolve(schema);
  }
}

function defaultNaming(operation: OperationInfo): string[] {
  const name =
    operation.operationId === undefined
      ? identifier(`${operation.method.toLowerCase()} ${operation.path.replace(/\{([^}]+)\}/g, 'by $1')}`)
      : identifier(operation.operationId);
  const tag = operation.tags[0];

  return tag === undefined ? [name] : [identifier(tag), name];
}

/** camelCase identifier from free text. */
function identifier(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = words
    .map((word, index) =>
      index === 0 ? word[0]?.toLowerCase() + word.slice(1) : word[0]?.toUpperCase() + word.slice(1),
    )
    .join('');

  return camel === '' ? 'operation' : /^\d/.test(camel) ? `_${camel}` : camel;
}

function uniqueName(name: string, used: Set<string>, source: string): string {
  let candidate = used.has(name) ? `${source}${name[0]?.toUpperCase()}${name.slice(1)}` : name;

  for (let index = 2; used.has(candidate); index++) {
    candidate = `${name}${index}`;
  }

  used.add(candidate);

  return candidate;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
