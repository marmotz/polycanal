import type { FieldDescriptor, OperationMeta, StandardSchemaV1 } from '@polycanal/core';

/** Field overrides of an endpoint: a schema replaces the discovered one, a descriptor sets its source and alias too. */
export type EndpointFields = Readonly<Record<string, StandardSchemaV1 | FieldDescriptor>>;

export interface EndpointOptions {
  /** Operation name. Default: the handler method name. */
  readonly name?: string;
  /** Namespace, overriding the controller's. */
  readonly namespace?: string | readonly string[];
  /** Response schema (required unless `outputOf` finds one). */
  readonly output?: StandardSchemaV1;
  /** Error body schemas by HTTP status. */
  readonly errors?: Readonly<Record<number, StandardSchemaV1>>;
  /** Input fields to add or replace, when the handler parameters carry no runtime schema. */
  readonly input?: EndpointFields;
  readonly meta?: OperationMeta;
}

const ENDPOINT = Symbol.for('polycanal.nest.endpoint');
const NAMESPACE = Symbol.for('polycanal.nest.namespace');

type Constructor = abstract new (...args: never[]) => unknown;

/**
 * Marks a controller method as part of the contract and attaches what discovery cannot find: the response schema,
 * error schemas, input fields without runtime schema, a name.
 *
 * @example
 * @Post('login')
 * @Endpoint({ output: LoginResponseSchema, errors: { 401: InvalidCredentialsSchema } })
 * login(@Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest) {}
 */
export function Endpoint(options: EndpointOptions = {}): MethodDecorator {
  return (target, propertyKey) => {
    const store = endpointStore(target.constructor as Constructor, true);
    store.set(propertyKey, options);
  };
}

/** Namespace of every endpoint of a controller. Default: the static segments of the controller path. */
export function EndpointNamespace(namespace: string | readonly string[]): ClassDecorator {
  return (target) => {
    (target as unknown as Record<symbol, unknown>)[NAMESPACE] =
      typeof namespace === 'string' ? [namespace] : [...namespace];
  };
}

/** Options given to `@Endpoint()` on a handler, `undefined` when it is not decorated. */
export function endpointOptions(controller: Constructor, method: string | symbol): EndpointOptions | undefined {
  return endpointStore(controller, false)?.get(method);
}

export function endpointNamespace(controller: Constructor): readonly string[] | undefined {
  return (controller as unknown as Record<symbol, readonly string[] | undefined>)[NAMESPACE];
}

function endpointStore(controller: Constructor, create: true): Map<string | symbol, EndpointOptions>;
function endpointStore(controller: Constructor, create: false): Map<string | symbol, EndpointOptions> | undefined;
function endpointStore(controller: Constructor, create: boolean): Map<string | symbol, EndpointOptions> | undefined {
  const holder = controller as unknown as Record<symbol, Map<string | symbol, EndpointOptions> | undefined>;

  if (create && !Object.hasOwn(holder, ENDPOINT)) {
    // Own map per class, seeded with the inherited endpoints
    holder[ENDPOINT] = new Map(holder[ENDPOINT] ?? []);
  }

  return holder[ENDPOINT];
}
