import {
  type ActionDescription,
  acceptsUndefined,
  type ContractDescription,
  describeContract,
  describeSchema,
  type FieldDescription,
  type InputDescription,
  type MergeConflict,
  mergeDescriptions,
} from '@polycanal/codegen';
import { type ContractTree, isStandardSchema, type JsonSchema } from '@polycanal/core';
import { type HttpMethod, rest } from '@polycanal/rest';
import { type EndpointOptions, endpointOf } from './endpoint.js';
import { fileKind, isMulterMiddleware } from './multipart.js';
import { type ExpressRoute, listRoutes } from './routes.js';

const METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface ExpressDiscoveryReport {
  /** Routes without `endpoint()` marker, left out of the contract. */
  readonly undescribed: readonly ExpressRoute[];
  /** Marked routes that could not be described, and why. */
  readonly skipped: readonly { readonly route: ExpressRoute; readonly reason: string }[];
  /** Routes described with a doubt, and why (multer without file field, `endpoint()` before multer). */
  readonly warnings: readonly string[];
  /** Disagreements between the config and the discovered routes (the config wins). */
  readonly conflicts: readonly MergeConflict[];
}

export interface ExpressDiscoveryOptions {
  /** Contract written in TS, with the highest priority (spec §3). */
  readonly config?: ContractTree;
}

export interface ExpressDiscovery {
  readonly description: ContractDescription;
  readonly report: ExpressDiscoveryReport;
}

/**
 * Discovers the routes of an Express 4 or 5 application and describes those marked with `endpoint()`. The application
 * only needs its routes mounted, it does not need to listen.
 */
export function discoverExpressContract(app: object, options: ExpressDiscoveryOptions = {}): ExpressDiscovery {
  const undescribed: ExpressRoute[] = [];
  const skipped: { route: ExpressRoute; reason: string }[] = [];
  const warnings: string[] = [];
  const operations: ActionDescription[] = [];

  for (const route of listRoutes(app)) {
    const markerIndex = route.handlers.findIndex((handler) => endpointOf(handler) !== undefined);
    const marker = markerIndex === -1 ? undefined : endpointOf(route.handlers[markerIndex]);

    if (marker === undefined) {
      undescribed.push(route);
      continue;
    }

    if (route.path === undefined) {
      skipped.push({ route, reason: route.problem ?? 'unknown path' });
      continue;
    }

    if (!METHODS.has(route.method)) {
      skipped.push({ route, reason: `HTTP method ${route.method} not supported` });
      continue;
    }

    const multerIndex = route.handlers.findIndex(isMulterMiddleware);
    const label = `${route.method} ${route.path}`;
    const input = describeInput(marker, route.path, label);
    const files = input !== undefined && hasFileField(input);
    const multipart = files || multerIndex !== -1;

    if (multipart && (route.method === 'GET' || route.method === 'DELETE')) {
      skipped.push({ route, reason: 'uploaded files need a POST, PUT or PATCH route' });
      continue;
    }

    if (multerIndex !== -1 && !files) {
      warnings.push(`${label}: multer is used, but endpoint() input declares no file field (z.file())`);
    }

    if (multerIndex > markerIndex) {
      warnings.push(`${label}: endpoint() runs before multer, it cannot see the uploaded files`);
    }

    operations.push(describeRoute(route.method as HttpMethod, route.path, marker, input, multipart));
  }

  const discovered: ContractDescription = { operations };

  if (options.config === undefined) {
    return { description: discovered, report: { undescribed, skipped, warnings, conflicts: [] } };
  }

  const { description, conflicts } = mergeDescriptions(describeContract(options.config), discovered);

  return { description, report: { undescribed, skipped, warnings, conflicts } };
}

function describeRoute(
  method: HttpMethod,
  path: string,
  options: EndpointOptions,
  input: InputDescription | undefined,
  multipart: boolean,
): ActionDescription {
  const label = `${method} ${path}`;
  const errors = Object.entries(options.errors ?? {});
  const namespace =
    options.namespace === undefined
      ? []
      : typeof options.namespace === 'string'
        ? [options.namespace]
        : [...options.namespace];

  return {
    family: 'action',
    path: [...namespace, options.name ?? defaultName(method, path)],
    binding: rest[method.toLowerCase() as Lowercase<HttpMethod>](path, {
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(multipart ? { body: 'multipart' as const } : {}),
    }),
    ...(input === undefined ? {} : { input }),
    output: describeSchema(options.output, 'output', `${label} output`),
    ...(errors.length === 0
      ? {}
      : {
          errors: Object.fromEntries(
            errors.map(([status, schema]) => [status, describeSchema(schema, 'output', `${label} error ${status}`)]),
          ),
        }),
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  };
}

function describeInput(options: EndpointOptions, path: string, label: string): InputDescription | undefined {
  const params = path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
  const fields: FieldDescription[] = [];

  if (isStandardSchema(options.input)) {
    const json = describeSchema(options.input, 'input', `${label} input`);
    const properties = typeof json === 'object' ? (json.properties as Record<string, unknown> | undefined) : undefined;

    if (properties === undefined) {
      throw new TypeError(`${label}: endpoint input must be an object schema or a field map`);
    }

    // Plain object schema: the client applies the default rules, nothing to add for path parameters it declares
    const missing = params.filter((param) => !(param in properties));

    if (missing.length === 0) {
      return { kind: 'schema', schema: json };
    }

    const declared = (json as { required?: unknown }).required;
    const required = new Set(Array.isArray(declared) ? (declared as string[]) : []);

    for (const [name, schema] of Object.entries(properties)) {
      fields.push({ name, schema: schema as FieldDescription['schema'], required: required.has(name) });
    }
  } else {
    for (const [name, field] of Object.entries(options.input ?? {})) {
      const descriptor = isStandardSchema(field) ? { schema: field } : field;

      fields.push({
        name,
        schema: describeSchema(descriptor.schema, 'input', `${label} input field "${name}"`),
        required: !acceptsUndefined(descriptor.schema),
        ...(descriptor.source === undefined ? {} : { source: descriptor.source }),
        ...(descriptor.alias === undefined ? {} : { alias: descriptor.alias }),
        ...(descriptor.root ? { root: true } : {}),
      });
    }
  }

  // Path parameters the endpoint does not describe are strings by nature
  for (const param of params) {
    const covered = fields.some(
      (field) => (field.alias ?? field.name) === param && (field.source ?? 'path') === 'path',
    );

    if (!covered) {
      const taken = fields.some((field) => field.name === param);
      fields.push({
        name: taken ? `path${param[0]?.toUpperCase()}${param.slice(1)}` : param,
        schema: { type: 'string' },
        required: true,
        source: 'path',
        ...(taken ? { alias: param } : {}),
      });
    }
  }

  return fields.length === 0 ? undefined : { kind: 'fields', fields };
}

/** Whether a described input has a file field (`z.file()`, or a list of them) sent in the body. */
function hasFileField(input: InputDescription): boolean {
  if (input.kind === 'schema') {
    const properties = typeof input.schema === 'object' ? input.schema.properties : undefined;

    return Object.values((properties ?? {}) as Record<string, JsonSchema>).some((schema) => fileKind(schema));
  }

  return input.fields.some((field) => (field.source ?? 'body') === 'body' && !field.root && fileKind(field.schema));
}

/** `GET /households/:id/members` → `getHouseholdsByIdMembers`. */
function defaultName(method: string, path: string): string {
  const words = [method.toLowerCase()];

  for (const segment of path.split('/').filter(Boolean)) {
    words.push(...(segment.startsWith(':') ? ['by', segment.slice(1)] : segment.split(/[^A-Za-z0-9]+/)));
  }

  return words
    .filter(Boolean)
    .map((word, index) => (index === 0 ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join('');
}
