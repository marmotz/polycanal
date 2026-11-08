import type { INestApplicationContext } from '@nestjs/common';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import {
  type ActionDescription,
  acceptsUndefined,
  type ContractDescription,
  describeContract,
  describeSchema,
  type FieldDescription,
  type MergeConflict,
  mergeDescriptions,
} from '@polycanal/codegen';
import { type ContractTree, isStandardSchema, type JsonSchema, type StandardSchemaV1 } from '@polycanal/core';
import { type HttpMethod, rest } from '@polycanal/rest';
import { type EndpointOptions, endpointNamespace, endpointOptions } from './decorators.js';

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
const PARAM_TYPES = { BODY: 3, QUERY: 4, PARAM: 5, HEADERS: 6 } as const;

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

/**
 * Discovers the routes of a Nest application and describes the endpoints that can be (spec §7). The application only
 * needs to be created (`NestFactory.create()` or a testing module), not listening.
 */
export function discoverNestContract(app: INestApplicationContext, options: NestDiscoveryOptions = {}): NestDiscovery {
  const discovery = new DiscoveryService(app.get(ModulesContainer));
  const prefix = options.globalPrefix ?? readGlobalPrefix(app);
  const schemaOf = options.schemaOf ?? defaultSchemaOf;
  const undescribed: NestRoute[] = [];
  const skipped: { route: NestRoute; reason: string }[] = [];
  const warnings: string[] = [];
  const operations: ActionDescription[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as Constructor | undefined;

    if (typeof controller !== 'function') {
      continue;
    }

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

  if (options.config === undefined) {
    return { description: discovered, report: { undescribed, skipped, warnings, conflicts: [] } };
  }

  const { description, conflicts } = mergeDescriptions(describeContract(options.config), discovered);

  return { description, report: { undescribed, skipped, warnings, conflicts } };
}

interface DescribeContext {
  readonly schemaOf: (pipe: unknown) => StandardSchemaV1 | undefined;
  readonly options: NestDiscoveryOptions;
  readonly warnings: string[];
  readonly controllerPaths: readonly string[];
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
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) ?? {}) as Record<string, RouteArgument>;

  // Path parameters first, so that they keep their name when a body or query field has the same one
  const order = [PARAM_TYPES.PARAM, PARAM_TYPES.HEADERS, PARAM_TYPES.QUERY, PARAM_TYPES.BODY] as number[];
  const sorted = Object.entries(args)
    .map(([key, argument]) => ({ type: Number(key.split(':')[0]), argument }))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.argument.index - b.argument.index);

  for (const { type, argument } of sorted) {
    const data = typeof argument.data === 'string' ? argument.data : undefined;
    const schema = (argument.pipes ?? []).map(context.schemaOf).find((found) => found !== undefined);

    switch (type) {
      case PARAM_TYPES.BODY:
        addSpreadOrField(fields, 'body', data, schema, label, context.warnings);
        break;
      case PARAM_TYPES.QUERY:
        addSpreadOrField(fields, 'query', data, schema, label, context.warnings);
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
      schema: describeSchema(descriptor.schema, 'input', `${label} input field "${name}"`),
      required: !acceptsUndefined(descriptor.schema),
      ...(descriptor.source === undefined ? {} : { source: descriptor.source }),
      ...(descriptor.alias === undefined ? {} : { alias: descriptor.alias }),
      ...(descriptor.root ? { root: true } : {}),
    });
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
    binding: rest[method.toLowerCase() as Lowercase<HttpMethod>](
      route.path,
      httpCode === undefined ? {} : { status: httpCode },
    ),
    ...(all.length === 0 ? {} : { input: { kind: 'fields', fields: all } }),
    output: describeSchema(output, 'output', `${label} output`),
    ...(errors.length === 0
      ? {}
      : {
          errors: Object.fromEntries(
            errors.map(([status, schema]) => [status, describeSchema(schema, 'output', `${label} error ${status}`)]),
          ),
        }),
    ...(decorated.meta === undefined ? {} : { meta: decorated.meta }),
  };

  function field(name: string, source: string, schema: StandardSchemaV1 | JsonSchema, required: boolean, raw: boolean) {
    const json = isStandardSchema(schema) ? describeSchema(schema, 'input', `${label} field "${name}"`) : schema;
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
  warnings: string[],
): void {
  if (data !== undefined) {
    const json =
      schema === undefined
        ? source === 'query'
          ? { type: 'string' }
          : true
        : describeSchema(schema, 'input', `${label} ${source} "${data}"`);
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
    warnings.push(`${label}: whole @${source === 'body' ? 'Body' : 'Query'}() without runtime schema, not described`);

    return;
  }

  const json = describeSchema(schema, 'input', `${label} ${source}`);
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
    fields.add({ name, source, schema: property, required: required.has(name), raw: false });
  }
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
    this.fields.set(name, description);
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
