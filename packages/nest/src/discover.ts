import type { INestApplicationContext } from '@nestjs/common';
import {
  type ActionDescription,
  acceptsUndefined,
  type ContractDescription,
  describeContract,
  describeSchema,
  type FieldDescription,
  importedSchema,
  type MergeConflict,
  mergeDescriptions,
  type SchemaImport,
} from '@polycanal/codegen';
import { type ContractTree, isStandardSchema, type JsonSchema, type StandardSchemaV1 } from '@polycanal/core';
import { type HttpMethod, rest } from '@polycanal/rest';
import { type EndpointOptions, endpointNamespace, endpointOptions } from './decorators.js';
import { FILES_PIPE, type FilePipe, type FilesPipe } from './files.js';

// Nest metadata keys and enums (@nestjs/common constants), stable across Nest 10 to 12
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const ROUTE_ARGS_METADATA = '__routeArguments__';
const HTTP_CODE_METADATA = '__httpCode__';
const REQUEST_METHODS: Readonly<Record<number, HttpMethod>> = {
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
};
const PARAM_TYPES = { BODY: 3, QUERY: 4, PARAM: 5, HEADERS: 6, FILE: 8, FILES: 9 } as const;

type Constructor = abstract new (...args: never[]) => unknown;

/** A route found on a controller. */
export interface NestRoute {
  readonly controller: string;
  readonly handler: string;
  readonly method: string;
  readonly path: string;
}

export interface NestDiscoveryReport {
  /** Routes left out of the contract because they are not decorated with `@Endpoint()`. */
  readonly undescribed: readonly NestRoute[];
  /** Routes that could not be described, and why. */
  readonly skipped: readonly { readonly route: NestRoute; readonly reason: string }[];
  /** Fields described without runtime schema (raw strings, unknown bodies). */
  readonly warnings: readonly string[];
  /** Disagreements between the config and the discovered routes (the config wins). */
  readonly conflicts: readonly MergeConflict[];
  /**
   * With `resolveSchema`: runtime schemas it did not find, generated from their JSON Schema instead of imported. They
   * lose what JSON Schema cannot express (transforms, refinements, custom messages).
   */
  readonly regenerated: readonly string[];
}

export interface NestDiscoveryOptions {
  /** `decorated` (default): only routes marked with `@Endpoint()`; `all`: every route that can be described. */
  readonly include?: 'decorated' | 'all';
  /** Contract written in TS, with the highest priority (spec §3). */
  readonly config?: ContractTree;
  /** Global prefix (`app.setGlobalPrefix()`). Default: read from the application when possible. */
  readonly globalPrefix?: string;
  /**
   * Finds the schema validated by a pipe. Default: the first own property of the pipe that is a Standard Schema
   * (`new ZodValidationPipe(schema)` stores it as `schema`).
   */
  readonly schemaOf?: (pipe: unknown) => StandardSchemaV1 | undefined;
  /** Finds the response schema of a handler when `@Endpoint()` has none (e.g. a project `@ZodResponse()`). */
  readonly outputOf?: (controller: Constructor, handler: string) => StandardSchemaV1 | undefined;
  /**
   * Where the generated contract can import a runtime schema from (e.g. the shared package exporting it), so that the
   * front end validates with the very same schema. A body or query schema found this way is kept whole, as a root
   * field. Schemas it does not find are generated from JSON Schema and listed in `report.regenerated`.
   */
  readonly resolveSchema?: (schema: StandardSchemaV1) => SchemaImport | undefined;
}

export interface NestDiscovery {
  readonly description: ContractDescription;
  readonly report: NestDiscoveryReport;
}

interface RouteArgument {
  readonly index: number;
  readonly data?: unknown;
  readonly pipes?: readonly unknown[];
}

class Skip extends Error {}

interface ContainerLike {
  getModules(): ReadonlyMap<unknown, { readonly controllers: ReadonlyMap<unknown, { readonly metatype: unknown }> }>;
}

/**
 * Controllers of every module, read from the application's own container rather than through `@nestjs/core` tokens:
 * discovery works whatever copy of Nest this package resolves (linked package, several Nest versions in a monorepo).
 */
function controllersOf(app: INestApplicationContext): unknown[] {
  const container = (app as unknown as { readonly container?: ContainerLike }).container;

  if (container === undefined || typeof container.getModules !== 'function') {
    throw new TypeError('discoverNestContract(): expected a Nest application or testing module');
  }

  return [...container.getModules().values()].flatMap((module) =>
    [...module.controllers.values()].map((wrapper) => wrapper.metatype),
  );
}

/**
 * Discovers the routes of a Nest application and describes the endpoints that can be (spec §7). The application only
 * needs to be created (`NestFactory.create()` or a testing module), not listening.
 */
export function discoverNestContract(app: INestApplicationContext, options: NestDiscoveryOptions = {}): NestDiscovery {
  const prefix = options.globalPrefix ?? readGlobalPrefix(app);
  const schemaOf = options.schemaOf ?? defaultSchemaOf;
  const undescribed: NestRoute[] = [];
  const skipped: { route: NestRoute; reason: string }[] = [];
  const warnings: string[] = [];
  const operations: ActionDescription[] = [];
  // Schemas generated from JSON Schema, by where they were found; only those left in the contract are reported
  const regeneratedAt = new Map<JsonSchema, string>();
  const describe: SchemaDescriber = (schema, io, location) => {
    const json = describeSchema(schema, io, location);
    const ref = options.resolveSchema?.(schema);

    if (ref !== undefined) {
      return importedSchema(json, ref);
    }

    if (options.resolveSchema !== undefined && typeof json === 'object') {
      regeneratedAt.set(json, location);
    }

    return json;
  };
  const inherit = (child: JsonSchema, parent: JsonSchema) => {
    const location = regeneratedAt.get(parent);

    if (location !== undefined && typeof child === 'object') {
      regeneratedAt.set(child, location);
    }
  };

  for (const metatype of controllersOf(app)) {
    if (typeof metatype !== 'function') {
      continue;
    }

    const controller = metatype as Constructor;

    const controllerPaths = asPaths(Reflect.getMetadata(PATH_METADATA, controller));

    for (const handler of methodNames(controller)) {
      const target = controller.prototype[handler] as object;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, target) as number | undefined;

      if (requestMethod === undefined) {
        continue;
      }

      const methodPaths = asPaths(Reflect.getMetadata(PATH_METADATA, target));
      const path = joinPaths(prefix, controllerPaths[0] ?? '', methodPaths[0] ?? '');
      const method = REQUEST_METHODS[requestMethod];
      const route: NestRoute = { controller: controller.name, handler, method: method ?? String(requestMethod), path };
      const decorated = endpointOptions(controller, handler);

      if (decorated === undefined && options.include !== 'all') {
        undescribed.push(route);
        continue;
      }

      try {
        if (method === undefined) {
          throw new Skip(`HTTP method ${requestMethod} not supported`);
        }

        if (controllerPaths.length > 1 || methodPaths.length > 1) {
          warnings.push(`${route.method} ${path}: several paths declared, only the first one is described`);
        }

        operations.push(
          describeRoute(route, method, controller, handler, decorated ?? {}, {
            schemaOf,
            options,
            warnings,
            controllerPaths,
            describe,
            inherit,
            resolved: (schema) => options.resolveSchema?.(schema) !== undefined,
          }),
        );
      } catch (error) {
        if (!(error instanceof Skip)) {
          throw error;
        }

        skipped.push({ route, reason: error.message });
      }
    }
  }

  const discovered: ContractDescription = { operations };
  const { description, conflicts } =
    options.config === undefined
      ? { description: discovered, conflicts: [] }
      : mergeDescriptions(describeContract(options.config), discovered);
  const regenerated = [
    ...new Set(
      schemasOf(description)
        .map((schema) => regeneratedAt.get(schema))
        .filter((location) => location !== undefined),
    ),
  ];

  return { description, report: { undescribed, skipped, warnings, conflicts, regenerated } };
}

/** Top-level schemas of the operations: fields, inputs, outputs and errors. */
function schemasOf(description: ContractDescription): JsonSchema[] {
  return description.operations.flatMap((operation) => {
    if (operation.family !== 'action') {
      return [];
    }

    const input =
      operation.input === undefined
        ? []
        : operation.input.kind === 'schema'
          ? [operation.input.schema]
          : operation.input.fields.map((field) => field.schema);

    return [...input, operation.output, ...Object.values(operation.errors ?? {})];
  });
}

/** JSON Schema of a runtime schema, marked as imported when `resolveSchema` finds it. */
type SchemaDescriber = (schema: StandardSchemaV1, io: 'input' | 'output', location: string) => JsonSchema;

interface DescribeContext {
  readonly schemaOf: (pipe: unknown) => StandardSchemaV1 | undefined;
  readonly options: NestDiscoveryOptions;
  readonly warnings: string[];
  readonly controllerPaths: readonly string[];
  readonly describe: SchemaDescriber;
  /** A schema taken out of a regenerated one (a property of a spread body) is regenerated with it. */
  readonly inherit: (child: JsonSchema, parent: JsonSchema) => void;
  /** Whether a schema is imported by the generated contract. */
  readonly resolved: (schema: StandardSchemaV1) => boolean;
}

function describeRoute(
  route: NestRoute,
  method: HttpMethod,
  controller: Constructor,
  handler: string,
  decorated: EndpointOptions,
  context: DescribeContext,
): ActionDescription {
  const label = `${route.method} ${route.path}`;

  if (/[*?()]/.test(route.path)) {
    throw new Skip('wildcard or pattern paths are not supported');
  }

  const output = decorated.output ?? context.options.outputOf?.(controller, handler);

  if (output === undefined) {
    throw new Skip('no response schema (use @Endpoint({ output }) or the outputOf option)');
  }

  const fields = new FieldSet();
  // Uploaded files without a field name: described only when `@Endpoint({ input })` declares a file field
  const unnamed: string[] = [];
  let multipart = false;
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) ?? {}) as Record<string, RouteArgument>;

  // Path parameters first, so that they keep their name when a body or query field has the same one
  const order = [
    PARAM_TYPES.PARAM,
    PARAM_TYPES.HEADERS,
    PARAM_TYPES.QUERY,
    PARAM_TYPES.BODY,
    PARAM_TYPES.FILE,
    PARAM_TYPES.FILES,
  ] as number[];
  const sorted = Object.entries(args)
    .map(([key, argument]) => ({ type: Number(key.split(':')[0]), argument }))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.argument.index - b.argument.index);

  for (const { type, argument } of sorted) {
    const data = typeof argument.data === 'string' ? argument.data : undefined;
    const schema = (argument.pipes ?? []).map(context.schemaOf).find((found) => found !== undefined);

    switch (type) {
      case PARAM_TYPES.BODY:
        addSpreadOrField(fields, 'body', data, schema, label, context);
        break;
      case PARAM_TYPES.QUERY:
        addSpreadOrField(fields, 'query', data, schema, label, context);
        break;
      case PARAM_TYPES.PARAM:
        if (data !== undefined) {
          // Path values are strings by nature: no warning without schema
          fields.add(field(data, 'path', schema ?? { type: 'string' }, true, false));
        }
        break;
      case PARAM_TYPES.HEADERS:
        if (data !== undefined) {
          fields.add(field(data.toLowerCase(), 'header', schema ?? { type: 'string' }, false, schema === undefined));
        }
        break;
      case PARAM_TYPES.FILE:
      case PARAM_TYPES.FILES:
        multipart = true;
        addFileFields(
          fields,
          type === PARAM_TYPES.FILE ? 'file' : 'files',
          argument,
          data,
          schema,
          label,
          unnamed,
          context,
        );
        break;
    }
  }

  // Path parameters read through @Param() without key, or not read at all
  for (const name of route.path.split('/').filter((segment) => segment.startsWith(':'))) {
    fields.ensurePath(name.slice(1));
  }

  for (const [name, override] of Object.entries(decorated.input ?? {})) {
    const descriptor = isStandardSchema(override) ? { schema: override } : override;
    fields.replace(name, {
      name,
      schema: context.describe(descriptor.schema, 'input', `${label} input field "${name}"`),
      required: !acceptsUndefined(descriptor.schema),
      ...(descriptor.source === undefined ? {} : { source: descriptor.source }),
      ...(descriptor.alias === undefined ? {} : { alias: descriptor.alias }),
      ...(descriptor.root ? { root: true } : {}),
    });
  }

  if (unnamed.length > 0 && !Object.values(decorated.input ?? {}).some((override) => declaresFile(override, label))) {
    for (const decorator of unnamed) {
      context.warnings.push(
        `${label}: ${decorator} without field name, not described (use filePipe(schema, { field }), filesPipe(schema, { field }) or @Endpoint({ input }))`,
      );
    }
  }

  if (multipart && (method === 'GET' || method === 'DELETE')) {
    throw new Skip('uploaded files need a POST, PUT or PATCH route');
  }

  for (const name of fields.raw) {
    context.warnings.push(`${label}: "${name}" has no runtime schema, described as a string`);
  }

  const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, controller.prototype[handler]) as number | undefined;
  const all = fields.list();
  const errors = Object.entries(decorated.errors ?? {});

  return {
    family: 'action',
    path: [...namespaceOf(controller, decorated, context.controllerPaths), decorated.name ?? handler],
    binding: rest[method.toLowerCase() as Lowercase<HttpMethod>](route.path, {
      ...(httpCode === undefined ? {} : { status: httpCode }),
      ...(multipart ? { body: 'multipart' as const } : {}),
    }),
    ...(all.length === 0 ? {} : { input: { kind: 'fields', fields: all } }),
    output: context.describe(output, 'output', `${label} output`),
    ...(errors.length === 0
      ? {}
      : {
          errors: Object.fromEntries(
            errors.map(([status, schema]) => [status, context.describe(schema, 'output', `${label} error ${status}`)]),
          ),
        }),
    ...(decorated.meta === undefined ? {} : { meta: decorated.meta }),
  };

  function field(name: string, source: string, schema: StandardSchemaV1 | JsonSchema, required: boolean, raw: boolean) {
    const json = isStandardSchema(schema) ? context.describe(schema, 'input', `${label} field "${name}"`) : schema;
    const isRequired = isStandardSchema(schema) ? !acceptsUndefined(schema) : required;

    return { name, source, schema: json, required: isRequired, raw };
  }
}

function addSpreadOrField(
  fields: FieldSet,
  source: 'body' | 'query',
  data: string | undefined,
  schema: StandardSchemaV1 | undefined,
  label: string,
  context: DescribeContext,
): void {
  if (data !== undefined) {
    const json =
      schema === undefined
        ? source === 'query'
          ? { type: 'string' }
          : true
        : context.describe(schema, 'input', `${label} ${source} "${data}"`);
    fields.add({
      name: data,
      source,
      schema: json,
      required: schema !== undefined && !acceptsUndefined(schema),
      raw: schema === undefined,
    });

    return;
  }

  if (schema === undefined) {
    context.warnings.push(
      `${label}: whole @${source === 'body' ? 'Body' : 'Query'}() without runtime schema, not described`,
    );

    return;
  }

  // An imported schema is kept whole: its object-level rules (refinements, transforms) apply to the whole value
  if (context.resolved(schema)) {
    fields.add({
      name: source,
      source,
      schema: context.describe(schema, 'input', `${label} ${source}`),
      required: !acceptsUndefined(schema),
      raw: false,
      root: true,
    });

    return;
  }

  const json = context.describe(schema, 'input', `${label} ${source}`);
  const properties = typeof json === 'object' ? (json.properties as Record<string, JsonSchema> | undefined) : undefined;

  if (properties === undefined || !Object.keys(properties).every((name) => /^[A-Za-z_$][\w$]*$/.test(name))) {
    if (source === 'query') {
      throw new Skip('whole @Query() schema is not an object with named properties');
    }

    fields.add({ name: 'body', source, schema: json, required: !acceptsUndefined(schema), raw: false, root: true });

    return;
  }

  const required = new Set(
    Array.isArray((json as { required?: unknown }).required) ? (json as { required: string[] }).required : [],
  );

  for (const [name, property] of Object.entries(properties)) {
    context.inherit(property, json);
    fields.add({ name, source, schema: property, required: required.has(name), raw: false });
  }
}

/**
 * Fields of `@UploadedFile()` / `@UploadedFiles()`. The field names given to `FileInterceptor()` and its siblings are
 * kept in a closure, out of reach: they come from the `@UploadedFile()` key, the `field` option of the pipe, or the
 * keys of the schemas (`filesPipe({ cover, photos })`, an object schema).
 */
function addFileFields(
  fields: FieldSet,
  kind: 'file' | 'files',
  argument: RouteArgument,
  data: string | undefined,
  schema: StandardSchemaV1 | undefined,
  label: string,
  unnamed: string[],
  context: DescribeContext,
): void {
  const pipe = (argument.pipes ?? []).find(isFilesPipe);
  const decorator = kind === 'file' ? '@UploadedFile()' : '@UploadedFiles()';
  const add = (name: string, fieldSchema: StandardSchemaV1 | JsonSchema | undefined, required?: boolean) => {
    if (fieldSchema === undefined) {
      fields.add({ name, source: 'body', schema: { type: 'string', format: 'binary' }, required: true, raw: false });
      context.warnings.push(`${label}: "${name}" has no runtime schema, described as a file`);

      return;
    }

    const json = isStandardSchema(fieldSchema)
      ? context.describe(fieldSchema, 'input', `${label} file "${name}"`)
      : fieldSchema;
    fields.add({
      name,
      source: 'body',
      schema: json,
      required: required ?? (isStandardSchema(fieldSchema) ? !acceptsUndefined(fieldSchema) : true),
      raw: false,
    });
  };

  if (kind === 'files' && pipe?.[FILES_PIPE] === 'files' && pipe.fields !== undefined) {
    for (const [name, fieldSchema] of Object.entries(pipe.fields)) {
      add(name, fieldSchema);
    }

    return;
  }

  const name = (kind === 'file' ? data : undefined) ?? pipe?.field;

  if (name !== undefined) {
    add(name, schema);

    return;
  }

  // `FileFieldsInterceptor()` validated with an object schema: one field per property
  if (kind === 'files' && schema !== undefined) {
    const json = context.describe(schema, 'input', `${label} files`);
    const object = typeof json === 'object' && json.type === 'object' ? json : undefined;
    const properties = object?.properties as Record<string, JsonSchema> | undefined;

    if (object !== undefined && properties !== undefined) {
      const required = new Set(Array.isArray(object.required) ? (object.required as string[]) : []);

      for (const [property, propertySchema] of Object.entries(properties)) {
        context.inherit(propertySchema, json);
        add(property, propertySchema, required.has(property));
      }

      return;
    }
  }

  unnamed.push(decorator);
}

function isFilesPipe(pipe: unknown): pipe is FilePipe | FilesPipe {
  return typeof pipe === 'object' && pipe !== null && FILES_PIPE in pipe;
}

/** Whether an `@Endpoint({ input })` override declares a file field (a file, or a list of files). */
function declaresFile(override: StandardSchemaV1 | { readonly schema: StandardSchemaV1 }, label: string): boolean {
  const schema = isStandardSchema(override) ? override : override.schema;

  try {
    return isFileJson(describeSchema(schema, 'input', label));
  } catch {
    return false;
  }
}

function isFileJson(json: JsonSchema): boolean {
  if (typeof json !== 'object') {
    return false;
  }

  if (json.format === 'binary') {
    return true;
  }

  if (json.items !== undefined && isFileJson(json.items as JsonSchema)) {
    return true;
  }

  const variants = [...(Array.isArray(json.anyOf) ? json.anyOf : []), ...(Array.isArray(json.oneOf) ? json.oneOf : [])];

  return variants.some((variant) => isFileJson(variant as JsonSchema));
}

interface PendingField extends Omit<FieldDescription, 'alias'> {
  readonly raw: boolean;
}

/** Fields of a route, keeping names unique across sources (a second `userId` becomes `bodyUserId`, aliased). */
class FieldSet {
  private readonly fields = new Map<string, FieldDescription>();
  readonly raw: string[] = [];

  add(pending: PendingField): void {
    const { raw, ...description } = pending;
    const existing = this.fields.get(pending.name);

    if (existing !== undefined && existing.source === pending.source) {
      return;
    }

    let name = pending.name;

    if (existing !== undefined) {
      name = `${pending.source}${pending.name[0]?.toUpperCase()}${pending.name.slice(1)}`;

      for (let index = 2; this.fields.has(name); index++) {
        name = `${pending.source}${pending.name}${index}`;
      }
    }

    this.fields.set(name, { ...description, name, ...(name === pending.name ? {} : { alias: pending.name }) });

    if (raw) {
      this.raw.push(name);
    }
  }

  ensurePath(wire: string): void {
    const covered = [...this.fields.values()].some(
      (field) => field.source === 'path' && (field.alias ?? field.name) === wire,
    );

    if (!covered) {
      this.add({ name: wire, source: 'path', schema: { type: 'string' }, required: true, raw: false });
    }
  }

  replace(name: string, description: FieldDescription): void {
    // A root field is the whole content of its source: it replaces the fields discovered there
    if (description.root && description.source !== undefined) {
      for (const [other, field] of this.fields) {
        if (other !== name && field.source === description.source) {
          this.fields.delete(other);
          this.dropRaw(other);
        }
      }
    }

    this.fields.set(name, description);
    this.dropRaw(name);
  }

  private dropRaw(name: string): void {
    const index = this.raw.indexOf(name);

    if (index !== -1) {
      this.raw.splice(index, 1);
    }
  }

  list(): FieldDescription[] {
    return [...this.fields.values()];
  }
}

function defaultSchemaOf(pipe: unknown): StandardSchemaV1 | undefined {
  if (typeof pipe !== 'object' || pipe === null) {
    return undefined;
  }

  return Object.values(pipe).find(isStandardSchema);
}

function namespaceOf(
  controller: Constructor,
  decorated: EndpointOptions,
  controllerPaths: readonly string[],
): string[] {
  if (decorated.namespace !== undefined) {
    return typeof decorated.namespace === 'string' ? [decorated.namespace] : [...decorated.namespace];
  }

  const declared = endpointNamespace(controller);

  if (declared !== undefined) {
    return [...declared];
  }

  return (controllerPaths[0] ?? '')
    .split('/')
    .filter((segment) => segment !== '' && !segment.startsWith(':'))
    .map(camelCase);
}

function camelCase(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word, index) =>
      index === 0 ? word[0]?.toLowerCase() + word.slice(1) : word[0]?.toUpperCase() + word.slice(1),
    )
    .join('');
}

function methodNames(controller: Constructor): string[] {
  const names = new Set<string>();

  for (
    let prototype = controller.prototype;
    prototype && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(prototype, name)?.value === 'function') {
        names.add(name);
      }
    }
  }

  return [...names];
}

function asPaths(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  return typeof value === 'string' ? [value] : [];
}

function joinPaths(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment !== '')
    .join('/');

  return `/${joined}`;
}

/** Reads the global prefix from a `NestApplication` (private `config`), empty when unavailable. */
function readGlobalPrefix(app: INestApplicationContext): string {
  const config = (app as unknown as { config?: { getGlobalPrefix?: () => string } }).config;

  return typeof config?.getGlobalPrefix === 'function' ? config.getGlobalPrefix() : '';
}
